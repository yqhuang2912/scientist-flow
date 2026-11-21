import "server-only"
import { createHash } from "node:crypto"
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { chatTurns, chats } from "../db/schema"
import { db } from "./db"
import {
  installationOwner,
  ModelConnectionError,
} from "./model-credentials.server"
import { chatAttachmentParts } from "./chat-composer"
import { chatMessagePreview } from "./chat-preview"
import {
  prepareSavedAttachments,
  workspaceAttachmentReference,
} from "./chat-attachment-context.server"
import { requireWorkspaceBinding } from "./workspace.server"
import { chatMemberChoice, validateChoice } from "./model-connections.server"
import type { ChatJobInput, ChatSnapshot, ChatTurnAck } from "./chat-job"
import type { UIMessage } from "ai"
import type { WorkflowInput } from "./workflow-run.server"

import type { WorkingStep } from "./chat-live"
import type { WorkflowCheckpoint } from "./workflow-checkpoint"

const t = chatTurns
export const workerMayClaim = sql`${t.userMessage} #>> '{metadata,checkpoint,phase}' is distinct from 'waiting'`
export class TurnConflict extends Error {}
export class ChatLeaseLost extends Error {}

export async function turnProgress(chatId: string, id: string) {
  const [row] = await db
    .select({
      turnId: t.id,
      workingStep: sql<WorkingStep | null>`${t.userMessage} #> '{metadata,workingStep}'`,
      checkpoint: sql<WorkflowCheckpoint | null>`${t.userMessage} #> '{metadata,checkpoint}'`,
      replies: t.replies,
      state: t.state,
      error: t.error,
    })
    .from(t)
    .where(
      and(eq(t.owner, installationOwner()), eq(t.chatId, chatId), eq(t.id, id))
    )
  return row
}

export async function chatSnapshot(chatId: string): Promise<ChatSnapshot> {
  const rows = await db
    .select({
      id: t.id,
      user: t.userMessage,
      replies: t.replies,
      state: t.state,
      error: t.error,
    })
    .from(t)
    .where(and(eq(t.chatId, chatId), eq(t.owner, installationOwner())))
    .orderBy(asc(t.createdAt), asc(t.id))
  return {
    messages: rows.flatMap((row) => [row.user, ...row.replies]),
    activeId:
      rows.find((row) => row.state === "queued" || row.state === "running")
        ?.id ?? null,
    error: rows.at(-1)?.error ?? null,
  }
}

export async function enqueueChatTurn(
  chatId: string,
  input: ChatJobInput,
  workflow?: WorkflowInput,
  checkpoint?: WorkflowCheckpoint
): Promise<ChatTurnAck> {
  const owner = installationOwner()
  const hash = createHash("sha256")
    .update(JSON.stringify(workflow ? { input, workflow } : input))
    .digest("hex")
  const lastMessagePreview = chatMessagePreview(input)
  const key = and(eq(t.chatId, chatId), eq(t.id, input.id))
  async function alreadySubmitted() {
    const [row] = await db
      .select({
        owner: t.owner,
        hash: t.inputHash,
        userMessage: t.userMessage,
        state: t.state,
        createdAt: t.createdAt,
      })
      .from(t)
      .where(key)
    if (row && (row.owner !== owner || row.hash !== hash))
      throw new TurnConflict("This message ID has already been used.")
    return (
      row && {
        turnId: input.id,
        userMessage: row.userMessage,
        state: row.state,
        acceptedAt: row.createdAt.toISOString(),
        lastMessagePreview,
      }
    )
  }
  const previous = await alreadySubmitted()
  if (previous) return previous
  await Promise.all(
    (input.mentionedBotIds ?? [input.botId]).map(async (id) => {
      const member = await chatMemberChoice(chatId, id)
      return validateChoice(workflow?.correction?.model ?? member)
    })
  )
  const paths = input.workspacePaths ?? []
  const prepare = async () => {
    if (!input.files.length && !paths.length) return []
    const { taskDir } = await requireWorkspaceBinding(chatId)
    const refs = await Promise.all(
      paths.map((p) => workspaceAttachmentReference(taskDir, p))
    )
    return prepareSavedAttachments(taskDir, [...input.files, ...refs])
  }
  const prepared = await prepare()
  const { parts, workspaceFiles } = chatAttachmentParts(prepared, input.text)
  const userMessage: UIMessage = {
    id: input.id,
    role: "user",
    metadata: {
      botId: input.botId,
      mentionedBotIds: input.mentionedBotIds,
      workspaceFiles,
      ...(workflow && { workflow }),
      ...(checkpoint && { checkpoint }),
    },
    parts,
  }
  if (Buffer.byteLength(JSON.stringify(userMessage)) > 480 * 1024)
    throw new ModelConnectionError(
      "This message is too large. Send fewer attachments."
    )
  const accepted = db.$with("accepted").as(
    db
      .insert(t)
      .values({
        chatId,
        id: input.id,
        owner,
        inputHash: hash,
        userMessage,
        // The browser compares millisecond timestamps. Give every accepted
        // turn a strictly later one; retries read that same persisted value.
        createdAt: sql`(select greatest(date_trunc('milliseconds', now()),
            date_trunc('milliseconds', ${chats.lastMessageAt}) + interval '1 millisecond')
            from ${chats} where ${chats.id} = ${chatId} for update)`,
      })
      .onConflictDoNothing()
      .returning({ createdAt: t.createdAt })
  )
  const inserted = await db
    .with(accepted)
    .update(chats)
    .set({
      lastMessagePreview,
      lastMessageAt: sql`(select ${accepted.createdAt} from ${accepted})`,
    })
    .where(and(eq(chats.id, chatId), sql`exists (select 1 from ${accepted})`))
    .returning({ acceptedAt: chats.lastMessageAt })
  if (inserted.length)
    return {
      turnId: input.id,
      userMessage,
      state: "queued",
      acceptedAt: inserted[0].acceptedAt.toISOString(),
      lastMessagePreview,
    }
  const replay = await alreadySubmitted()
  if (replay) return replay
  throw new TurnConflict("Another reply is already running in this chat.")
}

export async function cancelChatTurn(chatId: string, id: string) {
  await db
    .update(t)
    .set({
      cancelRequested: true,
      state: sql`case when ${t.state}='queued' or ${t.userMessage} #>> '{metadata,checkpoint,phase}'='waiting' then 'cancelled' else ${t.state} end`,
    })
    .where(
      and(
        eq(t.owner, installationOwner()),
        eq(t.chatId, chatId),
        eq(t.id, id),
        inArray(t.state, ["queued", "running"])
      )
    )
}

export async function leaseChatTurn(lease: string, activeChats: string[] = []) {
  const owner = installationOwner()
  const [job] = await db
    .update(t)
    .set({
      lease,
      state: "running",
      leaseUntil: sql`now() + interval '45 seconds'`,
    })
    .where(
      sql`(${t.chatId},${t.id}) = (select chat_id,id from ${t} where owner=${owner} and
      ${notInArray(t.chatId, activeChats)} and ${workerMayClaim} and
      (state='queued' or (state='running' and lease_until <= now()))
      order by created_at,id for update skip locked limit 1)`
    )
    .returning()
  return job
}

export function currentLease(lease: string) {
  return and(
    eq(t.lease, lease),
    eq(t.state, "running"),
    sql`${t.leaseUntil} > now()`
  )
}

export async function heartbeat(lease: string) {
  const [row] = await db
    .update(t)
    .set({ leaseUntil: sql`now() + interval '45 seconds'` })
    .where(currentLease(lease))
    .returning({ cancel: t.cancelRequested })
  return row
}

export async function saveWorkingStep(lease: string, step: WorkingStep) {
  const [row] = await db.update(t).set({
    userMessage: sql`jsonb_set(${t.userMessage}, '{metadata,workingStep}', ${JSON.stringify(step)}::jsonb)`,
  }).where(currentLease(lease)).returning({ id: t.id })
  if (!row) throw new ChatLeaseLost("Lost chat turn lease")
}

export async function saveProgress(lease: string, replies: UIMessage[], stepFinished = false) {
  const [row] = await db
    .update(t)
    .set({
      replies,
      ...(stepFinished && { userMessage: sql`${t.userMessage} #- '{metadata,workingStep}'` }),
    })
    .where(currentLease(lease))
    .returning({ id: t.id })
  if (!row) throw new ChatLeaseLost("Lost chat turn lease")
}

export async function settleTurn(
  lease: string,
  replies: UIMessage[],
  error: string | null
) {
  await db
    .update(t)
    .set({
      lease: null,
      leaseUntil: null,
      userMessage: sql`${t.userMessage} #- '{metadata,workingStep}'`,
      replies,
      error,
      state: sql`case when ${t.cancelRequested} then 'cancelled' when ${error !== null} then 'failed' else 'completed' end`,
    })
    .where(currentLease(lease))
}
