import type { UIMessage } from "ai"
import { z } from "zod"
import { storedAttachmentSchema } from "./chat-composer"
import { workspaceFileTargetSchema } from "./workspace-validation"

export type ChatJobState =
  "queued" | "running" | "completed" | "failed" | "cancelled"
export const chatJobInput = z
  .strictObject({
    id: z.string().regex(/^(?!workflow_)[a-zA-Z0-9_-]{1,128}$/),
    botId: z.nanoid(),
    mentionedBotIds: z.array(z.nanoid()).min(1).optional(),
    workspacePaths: z.array(workspaceFileTargetSchema).max(32).optional(),
    text: z.string().max(120_000),
    files: z
      .array(storedAttachmentSchema.omit({ contextOnly: true }))
      .max(32)
      .default([]),
  })
  .refine(
    ({ botId, mentionedBotIds: ids }) =>
      !ids || (ids[0] === botId && new Set(ids).size === ids.length),
    "Invalid mentioned bots."
  )
  .refine(
    ({ files, workspacePaths = [] }) =>
      files.length + workspacePaths.length <= 32 &&
      new Set(workspacePaths).size === workspacePaths.length,
    "Select up to 32 distinct attachments."
  )
  .refine(
    (input) =>
      !!input.text.trim() ||
      input.files.length > 0 ||
      !!input.workspacePaths?.length,
    "Write a message or attach a file."
  )
export type ChatJobInput = z.output<typeof chatJobInput>

export type ChatSnapshot = {
  messages: UIMessage[]
  activeId: string | null
  error: string | null
}

export type ChatTurnProgress = {
  turnId: string
  replies: UIMessage[]
  state: ChatJobState
  error: string | null
}

export type ChatTurnAck = {
  turnId: string
  userMessage: UIMessage
  state: ChatJobState
  acceptedAt: string
  lastMessagePreview: string
}

export function isActiveTurn(state: ChatJobState) {
  return state === "queued" || state === "running"
}

export function mergeTurnProgress(
  current: ChatSnapshot,
  turn: ChatTurnProgress
): ChatSnapshot {
  if (current.activeId !== turn.turnId) return current
  const start = current.messages.findIndex(
    (m) => m.role === "user" && m.id === turn.turnId
  )
  if (start < 0) return current
  const following = current.messages.findIndex(
    (m, i) => i > start && m.role === "user"
  )
  const end = following < 0 ? current.messages.length : following
  const replies = new Map(
    current.messages.slice(start + 1, end).map((m) => [m.id, m])
  )
  for (const message of turn.replies) replies.set(message.id, message)
  return {
    messages: [
      ...current.messages.slice(0, start + 1),
      ...replies.values(),
      ...current.messages.slice(end),
    ],
    activeId: isActiveTurn(turn.state) ? turn.turnId : null,
    error: turn.error,
  }
}

export function mergeTurnAck(
  current: ChatSnapshot,
  ack: ChatTurnAck,
  final?: ChatTurnProgress
): ChatSnapshot {
  const known = current.messages.some(
    (m) => m.role === "user" && m.id === ack.turnId
  )
  // A known, inactive turn has already settled. A late acknowledgement cannot reopen it.
  if (known && current.activeId !== ack.turnId) return current
  const next = known
    ? current
    : {
        messages: [...current.messages, ack.userMessage],
        activeId: ack.turnId,
        error: null,
      }
  return final ? mergeTurnProgress(next, final) : next
}
