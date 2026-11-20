import type { UIMessage } from "ai"
import { z } from "zod"
import { storedAttachmentSchema } from "./chat-composer"

export type ChatJobState =
  "queued" | "running" | "completed" | "failed" | "cancelled"
export const chatJobInput = z
  .strictObject({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    botId: z.nanoid(),
    text: z.string().max(120_000),
    files: z
      .array(storedAttachmentSchema.omit({ contextOnly: true }))
      .max(32)
      .default([]),
  })
  .refine(
    (input) => !!input.text.trim() || input.files.length > 0,
    "Write a message or attach a file."
  )
export type ChatJobInput = z.output<typeof chatJobInput>

export type ChatSnapshot = {
  messages: UIMessage[]
  activeId: string | null
  error: string | null
}

export type ChatTurnProgress = {
  replies: UIMessage[]
  state: ChatJobState
  error: string | null
}
