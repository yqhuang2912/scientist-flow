import { createHash } from "node:crypto"
import type { UIMessage } from "ai"
import type { BotIdentity } from "./chat-bot-context"
import { cleanBotText } from "./chat-bot-text"
import { getAssistantSegments, getHandoff } from "./chat-presentation"
import type { EvidencePassage, ProjectSources } from "./project-decisions"

// Input is the runner's accepted history for this chat. A tool call cannot supply it.
export function projectEvidence(
  chatId: string,
  history: UIMessage[],
  bots: BotIdentity[]
) {
  const passages = new Map<string, EvidencePassage>()
  const labels = new Map<string, Map<number, string>>()
  const lastUser = history.findLastIndex((m) => m.role === "user")
  const turnId = history[lastUser]?.id
  function add(
    m: UIMessage,
    index: number,
    author: string,
    role: EvidencePassage["role"]
  ) {
    const part = m.parts[index]
    if (
      part.type !== "text" ||
      part.state === "streaming" ||
      passages.size >= 32
    )
      return
    const text = role === "user" ? part.text : cleanBotText(part.text, bots)
    if (!text.trim()) return
    const ref =
      "S-" +
      createHash("sha256")
        .update(JSON.stringify([chatId, turnId, m.id, index]))
        .digest("hex")
        .slice(0, 10)
    passages.set(ref, { messageId: m.id, part: index, role, author, text })
    const indices = labels.get(m.id) ?? new Map<number, string>()
    indices.set(index, ref)
    labels.set(m.id, indices)
  }
  for (let i = lastUser; i >= 0 && passages.size < 32; i--) {
    const m = history[i]
    if (m.role === "user")
      m.parts.forEach((_, idx) => add(m, idx, "User", "user"))
    if (m.role !== "assistant") continue
    const handoff = m.parts.map(getHandoff).find(Boolean)
    for (const segment of getAssistantSegments(m, null)) {
      const name =
        bots.find((b) => b.id === segment.botId)?.name ??
        (segment.botId && segment.botId === handoff?.targetId
          ? handoff.targetName
          : segment.botId && segment.botId === handoff?.sourceId
            ? handoff.sourceName
            : null)
      for (const { index } of segment.parts)
        add(m, index, name ?? "Assistant", "assistant")
    }
  }
  return {
    sources: { chatId, passages } satisfies ProjectSources,
    labelHistory(messages: UIMessage[]) {
      return messages.map((m) => {
        const indices = labels.get(m.id)
        if (!indices || (m.role !== "user" && m.role !== "assistant")) return m
        return {
          ...m,
          parts: m.parts.map((p, i) =>
            p.type === "text" && indices.has(i)
              ? { ...p, text: "[" + indices.get(i) + "] " + p.text }
              : p
          ),
        }
      })
    },
  }
}
