import "server-only"
import { createHash } from "node:crypto"
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { chatTurns, chats } from "../db/schema"
import { db } from "./db"
import {
  installationOwner,
  ModelConnectionError,
} from "./model-credentials.server"
import { chatAttachmentParts, messageAttachmentSchema } from "./chat-composer"
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

import { retryTarget, type ChatRevision, type ReplyRetry } from "./chat-revision"
import { getMessageBotId } from "./chat-presentation"
import type { WorkingStep } from "./chat-live"
import type { WorkflowCheckpoint } from "./workflow-checkpoint"

const t = chatTurns
export const workerMayClaim = sql`${t.userMessage} #>> '{metadata,checkpoint,phase}' is distinct from 'waiting'`
export class TurnNotFound extends Error {}
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
  const hash = createHash("sha256")
    .update(JSON.stringify(workflow ? { input, workflow } : input))
    .digest("hex")
  const lastMessagePreview = chatMessagePreview(input)
  return acceptChatTurn(chatId, input.id, hash, lastMessagePreview, async () => {
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
    return userMessage
  })
}

async function acceptChatTurn(
  chatId: string,
  id: string,
  hash: string,
  lastMessagePreview: string,
  build: () => Promise<UIMessage>
): Promise<ChatTurnAck> {
  const owner = installationOwner()
  const key = and(eq(t.chatId, chatId), eq(t.id, id))
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
      throw new TurnConflict(id.startsWith("revision_")
        ? "This message already has a newer version. Refresh and edit the latest one."
        : "This message ID has already been used.")
    return (
      row && {
        turnId: id,
        userMessage: row.userMessage,
        state: row.state,
        acceptedAt: row.createdAt.toISOString(),
        lastMessagePreview,
      }
    )
  }
  const previous = await alreadySubmitted()
  if (previous) return previous
  const userMessage = await build()
  if (Buffer.byteLength(JSON.stringify(userMessage)) > 480 * 1024)
    throw new ModelConnectionError(
      "This message is too large. Send fewer attachments."
    )
  const accepted = db.$with("accepted").as(
    db
      .insert(t)
      .values({
        chatId,
        id,
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
      turnId: id,
      userMessage,
      state: "queued",
      acceptedAt: inserted[0].acceptedAt.toISOString(),
      lastMessagePreview,
    }
  const replay = await alreadySubmitted()
  if (replay) return replay
  throw new TurnConflict("Another reply is already running in this chat.")
}

export async function reviseChatTurn(
  chatId: string,
  sourceId: string,
  revision: ChatRevision,
  members: string[]
) {
  const [source] = await db
    .select({ user: t.userMessage, state: t.state, replies: t.replies })
    .from(t)
    .where(
      and(
        eq(t.chatId, chatId),
        eq(t.id, sourceId),
        eq(t.owner, installationOwner())
      )
    )
  if (!source) throw new TurnNotFound("Message not found.")
  const meta = source.user.metadata as {
    botId: string
    mentionedBotIds?: string[]
    workspaceFiles?: Record<number, unknown>
    workflow?: unknown
  }
  if (
    retryTarget(source.user) ||
    meta.workflow ||
    sourceId.startsWith("workflow_")
  )
    throw new TurnConflict("Use the workflow controls for this run.")
  if (source.state === "queued" || source.state === "running")
    throw new TurnConflict("Wait for the current reply to finish.")

  // Each reply has its own retry chain. A replay from the same head uses the same job.
  const retry = revision.action === "retry" ? revision : undefined
  const target =
    retry &&
    source.replies.find(
      (reply) => reply.id === retry.replyId && reply.role === "assistant"
    )
  if (retry && !target) throw new TurnNotFound("Reply not found in this turn.")
  const identity = retry
    ? JSON.stringify([sourceId, retry.replyId, retry.after])
    : sourceId
  const id = "revision_" + createHash("sha256").update(identity).digest("hex")
  const hash = createHash("sha256")
    .update(JSON.stringify(revision))
    .digest("hex")
  const refs = meta.workspaceFiles ?? {}
  const oldText = source.user.parts
    .flatMap((part, i) =>
      part.type === "text" && !(i in refs) ? [part.text] : []
    )
    .join("\n\n")
  const text = revision.action === "edit" ? revision.text : oldText
  const mentioned =
    revision.action === "edit" ? revision.mentionedBotIds : undefined
  const botId =
    (target && getMessageBotId(target)) ||
    mentioned?.[0] ||
    (revision.action === "edit" && meta.mentionedBotIds?.length
      ? members[0]
      : meta.botId)
  const files = Object.values(refs).flatMap((raw) => {
    const ref = messageAttachmentSchema.safeParse(raw).data
    return ref && !ref.contextOnly ? [ref] : []
  })
  const preview = chatMessagePreview({
    text,
    files: files.filter((ref) => !("origin" in ref)),
    workspacePaths: files.flatMap((ref) =>
      "origin" in ref ? [ref.relativePath] : []
    ),
  })
  return acceptChatTurn(chatId, id, hash, preview, async () => {
    if (retry) {
      const [attempts, edits] = await Promise.all([
        replyAttempts(chatId, { turnId: sourceId, replyId: retry.replyId }),
        db
          .select({ id: t.id })
          .from(t)
          .where(
            and(
              eq(t.chatId, chatId),
              eq(t.owner, installationOwner()),
              sql`${t.userMessage} #>> '{metadata,revises}' = ${sourceId}`
            )
          )
          .limit(1),
      ])
      if (edits.length)
        throw new TurnConflict(
          "The prompt was edited. Retry its current reply."
        )
      const headId = attempts.at(-1)?.id ?? null
      if (headId !== id && headId !== retry.after)
        throw new TurnConflict(
          "This reply has a newer version. Refresh to see it."
        )
    }
    if (
      !botId ||
      ![botId, ...(mentioned ?? [])].every((member) => members.includes(member))
    )
      throw new ModelConnectionError(
        "The original recipient is no longer in this chat."
      )
    await Promise.all(
      (mentioned?.length ? mentioned : [botId]).map(async (member) =>
        validateChoice(await chatMemberChoice(chatId, member))
      )
    )
    let parts = source.user.parts
    let workspaceFiles = refs
    if (revision.action === "edit") {
      parts = text.trim() ? [{ type: "text", text }] : []
      workspaceFiles = {}
      source.user.parts.forEach((part, i) => {
        if (part.type === "text" && !(i in refs)) return
        if (i in refs) workspaceFiles[parts.length] = refs[i]
        parts.push(part)
      })
      if (!parts.length)
        throw new TurnConflict("Write a message or attach a file.")
    }
    return {
      id,
      role: "user",
      parts,
      metadata: {
        botId,
        mentionedBotIds: mentioned,
        workspaceFiles,
        ...(retry
          ? { replyRetry: { turnId: sourceId, replyId: retry.replyId } }
          : { revises: sourceId }),
      },
    }
  })
}

function replyAttempts(chatId: string, target: ReplyRetry) {
  return db
    .select({
      id: t.id,
      versionId: sql<string | null>`${t.replies}->0->>'id'`,
      state: t.state,
    })
    .from(t)
    .where(
      and(
        eq(t.chatId, chatId),
        eq(t.owner, installationOwner()),
        sql`${t.userMessage} #>> '{metadata,replyRetry,turnId}' = ${target.turnId}`,
        sql`${t.userMessage} #>> '{metadata,replyRetry,replyId}' = ${target.replyId}`
      )
    )
    .orderBy(asc(t.createdAt), asc(t.id))
}

export async function chooseReplyVersion(
  chatId: string,
  attemptId: string,
  versionId: string
) {
  const key = and(
    eq(t.chatId, chatId),
    eq(t.id, attemptId),
    eq(t.owner, installationOwner())
  )
  const [row] = await db
    .select({
      target: sql<ReplyRetry | null>`${t.userMessage} #> '{metadata,replyRetry}'`,
    })
    .from(t)
    .where(key)
  if (!row?.target) throw new TurnNotFound("Reply version not found.")
  const attempts = await replyAttempts(chatId, row.target)
  const head = attempts.at(-1)
  if (
    head?.id !== attemptId ||
    head.state === "queued" ||
    head.state === "running"
  )
    throw new TurnConflict(
      "Wait for the latest reply, then choose its version."
    )
  if (
    versionId !== row.target.replyId &&
    !attempts.some((item) => item.versionId === versionId)
  )
    throw new TurnNotFound("Version not found for this reply.")
  await db
    .update(t)
    .set({
      userMessage: sql`jsonb_set(${t.userMessage}, '{metadata,replyChoice}', to_jsonb(${versionId}::text))`,
    })
    .where(key)
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
