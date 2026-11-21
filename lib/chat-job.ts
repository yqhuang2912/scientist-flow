import type { UIMessage } from "ai"
import { z } from "zod"
import { storedAttachmentSchema } from "./chat-composer"
import { workspaceFileTargetSchema } from "./workspace-validation"

export type ChatJobState =
  "queued" | "running" | "completed" | "failed" | "cancelled"
export const chatJobInput = z
  .strictObject({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
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
  replies: UIMessage[]
  state: ChatJobState
  error: string | null
}
