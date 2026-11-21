import type { UIMessage } from "ai"
import { z } from "zod"

export const editMessageFields = z.strictObject({
  text: z.string().max(120_000),
})
export const revisionInput = z.union([
  z.strictObject({
    action: z.literal("retry"),
    replyId: z.string().min(1).max(128),
    after: z.string().min(1).max(128).nullable(),
  }),
  editMessageFields.extend({
    action: z.literal("edit"),
    mentionedBotIds: z
      .array(z.nanoid())
      .refine((ids) => new Set(ids).size === ids.length),
  }),
])
export type ChatRevision = z.infer<typeof revisionInput>
export type ReviseMessage = (
  source: UIMessage,
  revision: ChatRevision
) => Promise<void | { error: string }>

export type ReplyRetry = { turnId: string; replyId: string }
export const SHOW_REPLY_EVIDENCE = "scientistflow:show-reply-evidence"
export type ReplyVersions = {
  user: UIMessage
  replies: UIMessage[]
  lastAttempt: string | null
  selected: number
}
export const versionChoice = z.strictObject({
  versionId: z.string().min(1).max(128),
})
export function retryTarget(message: UIMessage) {
  return (message.metadata as { replyRetry?: ReplyRetry } | undefined)
    ?.replyRetry
}

// A retry is a real worker job, but occupies the original bot's single reply slot.
export function projectReplyVersions(messages: UIMessage[]) {
  const visible: UIMessage[] = []
  const byMessage = new Map<string, ReplyVersions>()
  let user: UIMessage | undefined
  let retry: ReplyVersions | undefined
  for (const message of messages) {
    if (
      message.role === "user" &&
      !(message.metadata as { checkpointNote?: boolean } | undefined)
        ?.checkpointNote
    ) {
      user = message
      const target = retryTarget(user)
      retry = target ? byMessage.get(target.replyId) : undefined
      if (retry && retry.user.id === target?.turnId) {
        retry.lastAttempt = user.id
        const choice = (user.metadata as { replyChoice?: string }).replyChoice
        if (choice) {
          const index = retry.replies.findIndex((item) => item.id === choice)
          if (index >= 0) retry.selected = index
        }
      } else retry = undefined
    }
    if (user && retryTarget(user)) {
      if (retry && message.role === "assistant") {
        retry.replies.push(message)
        const choice = (user.metadata as { replyChoice?: string }).replyChoice
        if (!choice || choice === message.id)
          retry.selected = retry.replies.length - 1
        byMessage.set(message.id, retry)
      }
      continue
    }
    if (user && message.role === "assistant") {
      const slot = { user, replies: [message], lastAttempt: null, selected: 0 }
      byMessage.set(message.id, slot)
    }
    visible.push(message)
  }
  return {
    messages: visible.map((message) => {
      const slot = byMessage.get(message.id)
      return slot ? slot.replies[slot.selected] : message
    }),
    byMessage,
  }
}

type TurnGroup = { current: UIMessage[]; previous: UIMessage[][] }

// Rows arrive in acceptance order. Revisions occupy their source's place
// in the conversation while each attempt retains its own evidence and IDs.
export function chatTurnGroups(messages: UIMessage[]) {
  const groups: TurnGroup[] = []
  const byTurn = new Map<string, TurnGroup>()
  let group: TurnGroup | undefined
  for (const message of messages) {
    const meta = message.metadata as
      { revises?: string; checkpointNote?: boolean } | undefined
    if (message.role === "user" && !meta?.checkpointNote) {
      group = meta?.revises ? byTurn.get(meta.revises) : undefined
      if (group) {
        group.previous.push(group.current)
        group.current = []
      } else {
        group = { current: [], previous: [] }
        groups.push(group)
      }
      byTurn.set(message.id, group)
    }
    if (!group) {
      group = { current: [], previous: [] }
      groups.push(group)
    }
    group.current.push(message)
  }
  return groups
}
