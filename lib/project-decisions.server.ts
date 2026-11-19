import "server-only"
import { createHash } from "node:crypto"
import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm"
import {
  bots,
  chatMembers,
  chats,
  projectDecisions as decisions,
} from "../db/schema"
import { db } from "./db"
import {
  decisionInput,
  projectDecisionLimit,
  type ProjectSources,
} from "./project-decisions"

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
      db.execute(sql`insert into ${decisions} (chat_id,decision,next_step,creator_bot_id,creator_name,source_message_id,source_part,source_role,source_author,quote,fingerprint)
        select ${chatId},${decision},${nextStep ?? null},b.id,b.name,${passage.messageId},${passage.part},${passage.role},${passage.author},${quote},${digest}
        from ${chatMembers} m join ${bots} b on b.id=m.bot_id join ${chats} c on c.id=m.chat_id
        where m.chat_id=${chatId} and b.id=${botId} and c.kind='group'
        and (select count(*) from ${decisions} where chat_id=${chatId} and withdrawn_at is null) < ${projectDecisionLimit}
        on conflict (chat_id,fingerprint) do nothing`),
      db
        .select({ id: decisions.id, withdrawnAt: decisions.withdrawnAt })
        .from(decisions)
        .where(and(eq(decisions.chatId, chatId), eq(fingerprint, digest))),
    ])
    if (!member.length)
      return rejected("This bot is not a member of this project.")
    if (!rows[0])
      return rejected(
        "Project memory is full. Withdraw an obsolete decision before adding another."
      )
    if (rows[0].withdrawnAt) return rejected("This decision was withdrawn.")
    return { success: true as const, id: rows[0].id }
  } catch {
    console.error("Project decision write failed", chatId)
    return rejected("Could not save this decision. Please retry.")
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
