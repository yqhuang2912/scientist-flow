import type { UIMessage } from "ai"

export type WorkingStep = {
  nodeId: string
  title: string
  stage: number
  supplement: boolean
  botId: string
  messageId: string
  draft?: string
}

export type LiveText = { id: string; botId: string; part: number; text: string }
export type TextFrame = LiveText & { offset: number }

// A connection starts with a complete prefix. Later frames carry only new text.
export function applyTextFrame(
  previous: LiveText | undefined,
  frame: TextFrame
): LiveText | undefined {
  if (frame.offset === 0) return frame
  if (
    !previous ||
    previous.id !== frame.id ||
    previous.part !== frame.part ||
    previous.text.length !== frame.offset
  )
    return previous
  return { ...frame, text: previous.text + frame.text }
}

export function withLiveText(
  messages: UIMessage[],
  drafts: LiveText[]
): UIMessage[] {
  if (!drafts.length) return messages
  const result = [...messages]
  for (const draft of drafts) {
    const index = result.findIndex((m) => m.id === draft.id)
    const saved = result[index]
    if ((saved?.metadata as { artifact?: unknown } | undefined)?.artifact)
      continue
    const prior = saved?.parts[draft.part]
    if (
      prior?.type === "text" &&
      (prior.state === "done" || prior.text.length >= draft.text.length)
    )
      continue
    if (prior && prior.type !== "text") continue
    const parts = [...(saved?.parts ?? [])]
    parts[Math.min(draft.part, parts.length)] = {
      type: "text",
      text: draft.text,
      state: "streaming",
    }
    const message: UIMessage = saved
      ? { ...saved, parts }
      : {
          id: draft.id,
          role: "assistant",
          metadata: { botId: draft.botId },
          parts,
        }
    if (index < 0) result.push(message)
    else result[index] = message
  }
  return result
}
