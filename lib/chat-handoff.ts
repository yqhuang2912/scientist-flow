import { z } from "zod"

export const handoffDescription =
  "Pass the user's request to another bot in this group chat when that bot is clearly better suited to answer it."

export const handoffInputSchema = z.object({
  botName: z
    .string()
    .min(1)
    .describe(
      "The exact name of the group member who should answer next. Do not use an internal id."
    ),
  reason: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The concrete public task for the recipient, with the requested deliverable. Only include information intended for the group."
    ),
})
export type HandoffInput = z.infer<typeof handoffInputSchema>
