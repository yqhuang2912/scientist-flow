import { z } from "zod"

export const chatComposerSchema = z.object({
  text: z
    .string()
    .refine((text) => text.trim().length > 0, "Write a message first."),
})

export type ChatComposerMessage = z.infer<typeof chatComposerSchema>

export function shouldSubmitChatMessage({
  key,
  shiftKey,
  isComposing,
  keyCode,
}: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode?: number
}) {
  return key === "Enter" && !shiftKey && !isComposing && keyCode !== 229
}
