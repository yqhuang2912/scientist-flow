import "server-only"
import { createHash } from "node:crypto"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { chatTurns, chats } from "../db/schema"
import { db } from "./db"
import {
  installationOwner,
  ModelConnectionError,
} from "./model-credentials.server"
import { chatAttachmentParts } from "./chat-composer"
import {
  prepareSavedAttachments,
  workspaceAttachmentReference,
} from "./chat-attachment-context.server"
import { requireWorkspaceBinding } from "./workspace.server"
import { chatMemberChoice, validateChoice } from "./model-connections.server"
import type { ChatJobInput, ChatSnapshot } from "./chat-job"
import type { UIMessage } from "ai"

const t = chatTurns
export class TurnConflict extends Error {}
export class ChatLeaseLost extends Error {}

export async function turnProgress(chatId: string, id: string) {
  const [row] = await db
    .select({ replies: t.replies, state: t.state, error: t.error })
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

export async function enqueueChatTurn(chatId: string, input: ChatJobInput) {
  const owner = installationOwner()
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex")
  const key = and(eq(t.chatId, chatId), eq(t.id, input.id))
  async function alreadySubmitted() {
    const [row] = await db
      .select({ owner: t.owner, hash: t.inputHash })
      .from(t)
      .where(key)
    if (row && (row.owner !== owner || row.hash !== hash))
      throw new TurnConflict("This message ID has already been used.")
    return !!row
  }
  if (await alreadySubmitted()) return
  await Promise.all(
    (input.mentionedBotIds ?? [input.botId]).map(async (id) =>
      validateChoice(await chatMemberChoice(chatId, id))
    )
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
    },
    parts,
  }
  if (Buffer.byteLength(JSON.stringify(userMessage)) > 480 * 1024)
    throw new ModelConnectionError(
      "This message is too large. Send fewer attachments."
    )
  const accepted = db
    .$with("accepted")
    .as(
      db
        .insert(t)
        .values({ chatId, id: input.id, owner, inputHash: hash, userMessage })
        .onConflictDoNothing()
        .returning({ id: t.id })
    )
  const inserted = await db
    .with(accepted)
    .update(chats)
    .set({ lastMessageAt: new Date() })
    .where(and(eq(chats.id, chatId), sql`exists (select 1 from ${accepted})`))
    .returning({ id: chats.id })
  if (!inserted.length && !(await alreadySubmitted()))
    throw new TurnConflict("Another reply is already running in this chat.")
}

export async function cancelChatTurn(chatId: string, id: string) {
  await db
    .update(t)
    .set({
      cancelRequested: true,
      state: sql`case when ${t.state}='queued' then 'cancelled' else ${t.state} end`,
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

export async function leaseChatTurn(lease: string) {
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

export async function saveProgress(lease: string, replies: UIMessage[]) {
  const [row] = await db
    .update(t)
    .set({ replies })
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
      replies,
      error,
      state: sql`case when ${t.cancelRequested} then 'cancelled' when ${error !== null} then 'failed' else 'completed' end`,
    })
    .where(currentLease(lease))
}
