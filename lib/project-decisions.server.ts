import "server-only"
import { createHash } from "node:crypto"
import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm"
import {
  bots,
  type ProjectDecision,
  botExecutions,
  chatMembers,
  chats,
  projectDecisions as decisions,
} from "../db/schema"
import { db } from "./db"
import {
  decisionInput,
  projectDecisionLimit,
  toolDecisionInput,
  toolEvidenceText,
  type ToolEvidence,
  type EvidencePassage,
  type ProjectSources,
} from "./project-decisions"
import {
  snapshotToolEvidence,
  type EvidenceScope,
  type ToolObservation,
} from "./tool-result-evidence"

const { fingerprint, ...publicFields } = getTableColumns(decisions)
const group = (id: string) => and(eq(chats.id, id), eq(chats.kind, "group"))
export async function readProjectDecisions(chatId: string, recordId?: string) {
  try {
    const rows = await db
      .select({ record: publicFields })
      .from(chats)
      .leftJoin(
        decisions,
        and(
          eq(decisions.chatId, chats.id),
          isNull(decisions.withdrawnAt),
          recordId === undefined ? undefined : eq(decisions.id, recordId)
        )
      )
      .where(group(chatId))
      .orderBy(asc(decisions.createdAt), asc(decisions.id))
    if (rows.length)
      return rows.flatMap((row) => (row.record ? [row.record] : []))
  } catch {
    console.error("Project decision read failed", chatId)
  }
  throw new Error("Could not load this project's decisions. Please retry.")
}

function rejected(error: string) {
  return { success: false as const, error }
}
export async function recordProjectDecision(
  chatId: string,
  botId: string,
  sources: ProjectSources,
  input: unknown
) {
  const parsed = decisionInput.safeParse(input)
  if (!parsed.success)
    return rejected(
      "Invalid decision. Check the source reference and field lengths."
    )
  const { source, quote, decision, nextStep } = parsed.data
  const passage = sources.passages.get(source)
  if (sources.chatId !== chatId || !passage || !passage.text.includes(quote))
    return rejected(
      "Use an exact quotation from the indicated public message in this project."
    )
  const digest = createHash("sha256")
    .update(JSON.stringify([passage.messageId, passage.part, decision]))
    .digest("hex")
  const saved = await persistDecision(
    chatId,
    botId,
    decision,
    nextStep ?? null,
    passage,
    quote,
    digest,
    null
  )
  return saved.success ? { success: true as const, id: saved.row.id } : saved
}

type StoredSource = Omit<EvidencePassage, "text" | "part"> & {
  part: number | null
}

async function persistDecision(
  chatId: string,
  botId: string,
  decision: string,
  nextStep: string | null,
  passage: StoredSource,
  quote: string,
  digest: string,
  toolEvidence: ToolEvidence | null
) {
  const membership = and(
    eq(chatMembers.botId, botId),
    eq(chatMembers.chatId, chatId)
  )
  try {
    const [, member, , rows] = await db.batch([
      db
        .select({ id: chats.id })
        .from(chats)
        .where(group(chatId))
        .for("no key update"),
      db
        .select({ id: chatMembers.botId })
        .from(chatMembers)
        .innerJoin(chats, eq(chatMembers.chatId, chats.id))
        .where(and(group(chatId), membership))
        .for("share", { of: chatMembers }),
      db.execute(sql`insert into ${decisions} (chat_id,decision,next_step,creator_bot_id,creator_name,source_message_id,source_part,source_role,source_author,quote,fingerprint,tool_evidence)
        select ${chatId},${decision},${nextStep},b.id,b.name,${passage.messageId},${passage.part},${passage.role},${passage.author},${quote},${digest},${toolEvidence ? JSON.stringify(toolEvidence) : null}::jsonb
        from ${chatMembers} m join ${bots} b on b.id=m.bot_id join ${chats} c on c.id=m.chat_id
        where m.chat_id=${chatId} and b.id=${botId} and c.kind='group'
        ${toolEvidence ? sql`and exists (select 1 from ${botExecutions} e where e.id=${toolEvidence.executionId} and e.chat_id=c.id and e.bot_id=b.id and e.message_id=${passage.messageId} and e.parent_execution_id is not null and e.status='running')` : sql``}
        and (select count(*) from ${decisions} where chat_id=${chatId} and withdrawn_at is null) < ${projectDecisionLimit}
        on conflict (chat_id,fingerprint) do nothing`),
      db
        .select(publicFields)
        .from(decisions)
        .where(and(eq(decisions.chatId, chatId), eq(fingerprint, digest))),
    ])
    if (!member.length)
      return rejected("This bot is not a member of this project.")
    if (!rows[0])
      return rejected(
        toolEvidence
          ? "Decision not saved. The execution is no longer active or project memory is full."
          : "Project memory is full. Withdraw an obsolete decision before adding another."
      )
    if (rows[0].withdrawnAt) return rejected("This decision was withdrawn.")
    return { success: true as const, row: rows[0] }
  } catch {
    console.error("Project decision write failed", chatId)
    return rejected("Could not save this decision. Please retry.")
  }
}

export async function recordToolProjectDecision(
  scope: EvidenceScope,
  lookup: (ref: string) => ToolObservation | undefined,
  input: unknown
) {
  const parsed = toolDecisionInput.safeParse(input)
  if (!parsed.success)
    return rejected(
      "Decision not saved. Provide the source reference and exact public field paths and values."
    )
  const { source, fields, decision } = parsed.data
  const live = lookup(source)
  let row: ProjectDecision | undefined
  let writeError: string | undefined
  if (live) {
    const snapshot = snapshotToolEvidence(scope, live, parsed.data)
    if ("error" in snapshot)
      return rejected("Decision not saved. " + snapshot.error)
    const saved = await persistDecision(
      scope.chatId,
      scope.botId,
      decision,
      null,
      {
        messageId: scope.messageId,
        part: null,
        role: "assistant",
        author: snapshot.toolName,
      },
      toolEvidenceText(snapshot.fields),
      source,
      snapshot
    )
    if (saved.success) row = saved.row
    else writeError = saved.error
  }
  if (!row) {
    // A committed write can outlive its in-memory HTTP result. Recover only
    // the receipt owned by this execution, and never insert from history.
    const [stored] = await db
      .select(publicFields)
      .from(decisions)
      .innerJoin(chats, eq(chats.id, decisions.chatId))
      .innerJoin(
        chatMembers,
        and(
          eq(chatMembers.chatId, chats.id),
          eq(chatMembers.botId, scope.botId)
        )
      )
      .where(
        and(
          group(scope.chatId),
          eq(decisions.creatorBotId, scope.botId),
          eq(decisions.sourceMessageId, scope.messageId),
          eq(fingerprint, source),
          isNull(decisions.withdrawnAt)
        )
      )
    const evidence = stored?.toolEvidence
    if (
      !evidence ||
      evidence.executionId !== scope.executionId ||
      !fields.every((f) =>
        evidence.fields.some(
          (v) => v.path === f.path && String(v.value) === f.value
        )
      )
    )
      return rejected(
        writeError ??
          "Decision not saved. No matching successful tool observation in this execution."
      )
    row = stored
  }
  return {
    success: true as const,
    id: row.id,
    decision: row.decision,
    sourceMessageId: row.sourceMessageId,
    toolEvidence: row.toolEvidence!,
  }
}

export async function withdrawProjectDecision(chatId: string, id: string) {
  const rows = await db
    .update(decisions)
    .set({ withdrawnAt: new Date() })
    .from(chats)
    .where(
      and(
        group(chatId),
        eq(decisions.chatId, chats.id),
        eq(decisions.id, id),
        isNull(decisions.withdrawnAt)
      )
    )
    .returning({ id: decisions.id })
  return rows.length > 0
}
