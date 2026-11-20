import type { UIMessage, UIMessageChunk } from "ai"
import { z } from "zod"
import type { ExecutionStatus } from "./bot-execution"

export const nativeTurnInput = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    botId: z.nanoid(),
    text: z
      .string()
      .max(120_000)
      .refine((s) => !!s.trim()),
  })
  .strict()

export function nativeChatMember(
  chat: {
    nativeDirect: boolean
    kind: string
    bots: { id: string }[]
  } | null
) {
  return chat?.nativeDirect && chat.kind === "direct" && chat.bots.length === 1
    ? chat.bots[0].id
    : null
}

type Turn = {
  userMessageId: string
  botId: string
  userText: string | null
  status: ExecutionStatus
  message: UIMessage | null
}

export function nativeTranscript(rows: Turn[]): UIMessage[] {
  return rows.flatMap((r): UIMessage[] => {
    if (r.userText === null) return []
    const user: UIMessage = {
      id: r.userMessageId,
      role: "user",
      metadata: { botId: r.botId },
      parts: [{ type: "text", text: r.userText }],
    }
    return r.status === "completed" && r.message ? [user, r.message] : [user]
  })
}

export class NativeTurnConflict extends Error {}

export function replayNativeTurn(
  row: Turn,
  input: z.infer<typeof nativeTurnInput>
) {
  if (row.userText !== input.text || row.botId !== input.botId)
    throw new NativeTurnConflict(
      "This message ID was already used for a different message."
    )
  if (row.status !== "completed" || !row.message)
    throw new NativeTurnConflict(
      row.status === "running"
        ? "This reply is already running."
        : "This turn ended without a reply. Send a new message to try again."
    )
  const { id, parts, metadata } = row.message
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({
        type: "start",
        messageId: id,
        messageMetadata: metadata,
      })
      for (const part of parts) {
        if (part.type !== "text") continue
        controller.enqueue({ type: "text-start", id })
        controller.enqueue({ type: "text-delta", id, delta: part.text })
        controller.enqueue({ type: "text-end", id })
      }
      controller.enqueue({ type: "finish" })
      controller.close()
    },
  })
}
