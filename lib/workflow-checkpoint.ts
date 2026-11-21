import type { UIMessage } from "ai"
import { z } from "zod"

export const checkpointCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("pause") }),
  z.strictObject({ action: z.literal("continue") }),
  z.strictObject({
    action: z.literal("submit"),
    note: z.string().trim().min(1).max(4000),
    mentionedBotIds: z.array(z.nanoid()).max(64).optional(),
  }),
])
export type CheckpointCommand = z.infer<typeof checkpointCommand>
export type WorkflowCheckpoint = {
  phase: "open" | "armed" | "waiting" | "released" | "passed"
  revision: number
  mentionedBotIds?: string[]
  afterMessageId?: string | null
  note?: string
}

export function initialCheckpoint(
  command?: CheckpointCommand
): WorkflowCheckpoint {
  if (command?.action === "submit")
    return {
      phase: "released",
      revision: 0,
      afterMessageId: null,
      note: command.note,
      ...(command.mentionedBotIds?.length && {
        mentionedBotIds: command.mentionedBotIds,
      }),
    }
  return { phase: command?.action === "pause" ? "armed" : "open", revision: 0 }
}

// Notes are part of their workflow turn. Present them as ordinary user messages
// without enqueueing another turn or changing the worker's execution slots.
export function checkpointTranscript(messages: UIMessage[]): UIMessage[] {
  const after = new Map<string, UIMessage>()
  for (let i = 0; i < messages.length; i++) {
    const turn = messages[i]
    if (turn.role !== "user") continue
    const checkpoint = (
      turn.metadata as { checkpoint?: WorkflowCheckpoint } | undefined
    )?.checkpoint
    if (!checkpoint?.note) continue
    let anchor = checkpoint.afterMessageId ?? turn.id
    if (checkpoint.afterMessageId === undefined) {
      // Earlier notes did not record an anchor. Place them at the boundary.
      for (let j = i + 1; j < messages.length; j++) {
        const reply = messages[j]
        const meta = reply.metadata as
          { workflowStep?: number; intervention?: string } | undefined
        if (
          reply.role !== "assistant" ||
          meta?.workflowStep !== 1 ||
          meta.intervention
        )
          break
        anchor = reply.id
      }
    }
    const recipient = (turn.metadata as { botId?: string }).botId
    after.set(anchor, {
      id: turn.id + "_checkpoint_note",
      role: "user",
      ...(recipient && {
        metadata: {
          botId: recipient,
          checkpointNote: true,
          mentionedBotIds: checkpoint.mentionedBotIds ?? [],
        },
      }),
      parts: [{ type: "text", text: checkpoint.note }],
    })
  }
  if (!after.size) return messages
  return messages.flatMap((message) => {
    const note = after.get(message.id)
    const instruction = (
      message.metadata as { intervention?: string } | undefined
    )?.intervention
    // Older supplement replies included the user's instruction verbatim in the heading.
    if (instruction && message.role === "assistant") {
      const heading = "**人工介入 · 补充实验**\n\n"
      const prefix = heading + instruction + "\n\n"
      if (
        message.parts.some(
          (p) => p.type === "text" && p.text.startsWith(prefix)
        )
      ) {
        message = {
          ...message,
          parts: message.parts.map((p) =>
            p.type === "text" && p.text.startsWith(prefix)
              ? { ...p, text: heading + p.text.slice(prefix.length) }
              : p
          ),
        }
      }
    }
    return note ? [message, note] : [message]
  })
}
