import type { ModelMessage } from "ai"
import type { Skill } from "../db/schema"
import { serializeSkillToMarkdown, skillPath } from "./skill-definition"

export type BoundSkill = Pick<
  Skill,
  "id" | "name" | "description" | "instructions" | "updatedAt"
> & { botId: string }
export const pastRead =
  "Past skill read. Consult your current catalog and read the skill again if relevant."

/** One server-owned snapshot per reply. Only receipts are serialized to the transcript. */
export function skillTurn(bindings: BoundSkill[]) {
  const reads = new Map<string, { botId: string; content: string }>()
  function catalog(botId: string) {
    const available = bindings
      .filter((row) => row.botId === botId)
      .map(({ name, description }) => ({ name, description }))
    return available.length
      ? "Your shared skills for this turn (name and when to use):\n" +
          JSON.stringify(available) +
          "\nFor each new request, use this current catalog. If the task matches a description, call read_skill before answering, even if a previous request looked similar. Apply the returned instructions to the final answer. Skip unrelated skills. A skill grants no additional tools."
      : "You have no assigned skills for this turn. Earlier skill reads do not grant access."
  }
  function read(botId: string, name: string, callId: string) {
    const skill = bindings.find((s) => s.botId === botId && s.name === name)
    if (!skill)
      return {
        success: false as const,
        botId,
        name,
        skillId: null,
        version: null,
        message: "This skill is not assigned to this bot.",
      }
    const version = skill.updatedAt.toISOString()
    reads.set(callId, { botId, content: serializeSkillToMarkdown(skill) })
    return {
      success: true as const,
      botId,
      name,
      skillId: skill.id,
      version,
      path: skillPath(name),
    }
  }
  // Preserve tool-call/result pairs across a handoff, but withdraw the source's instructions.
  function forSpeaker(messages: ModelMessage[], botId: string): ModelMessage[] {
    if (![...reads.values()].some((read) => read.botId !== botId))
      return messages
    return messages.map((message) =>
      message.role !== "tool"
        ? message
        : {
            ...message,
            content: message.content.map((part) => {
              if (part.type !== "tool-result" || part.toolName !== "read_skill")
                return part
              const loaded = reads.get(part.toolCallId)
              return loaded && loaded.botId !== botId
                ? {
                    ...part,
                    output: { type: "text" as const, value: pastRead },
                  }
                : part
            }),
          }
    )
  }
  return {
    catalog,
    read,
    forSpeaker,
    hasRead: (botId: string) =>
      [...reads.values()].some((read) => read.botId === botId),
    content: (callId: string) => reads.get(callId)?.content,
  }
}
