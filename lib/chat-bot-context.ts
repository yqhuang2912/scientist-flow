import type { UIMessage } from "ai"

export type BotIdentity = {
  id: string
  name: string
  job: string
  instructions: string | null
}

export type BotChatContext = {
  kind: "direct" | "group"
  bots: BotIdentity[]
}

export function resolveReplyBot(
  context: BotChatContext | null,
  requestedBotId?: string
) {
  if (!context || context.bots.length === 0) {
    throw new Error("No bot is available in this chat.")
  }
  const bot = requestedBotId
    ? context.bots.find((candidate) => candidate.id === requestedBotId)
    : context.bots[0]
  if (!bot) {
    throw new Error("The selected bot is no longer a member of this chat.")
  }
  return bot
}

export function botInstructions(
  bot: BotIdentity,
  context: BotChatContext,
  options: { handoffAvailable?: boolean } = {}
) {
  const identity = [
    `Your name is ${JSON.stringify(bot.name)}. Your job is ${JSON.stringify(bot.job)}.`,
    "This is your identity for the current response. Historical replies belong to their attributed speakers, even if they introduce themselves differently. Do not adopt their name, job or persona.",
    "Bracketed speaker and addressee labels in the conversation are internal context only. Never print, imitate or mention those labels. Output only your natural reply to the user.",
    bot.instructions ? `Your working instructions: ${bot.instructions}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  if (context.kind !== "group") return identity

  const members = context.bots
    .map(
      (member) =>
        `${JSON.stringify(member.name)}: ${JSON.stringify(member.job)}${member.id === bot.id ? " (you)" : ""}`
    )
    .join("\n")
  const handoff =
    options.handoffAvailable === false
      ? "Answer the original request as yourself. Do not hand off again."
      : "Use handoff only when another member is clearly better suited to the request. Use their exact name. Never hand off to yourself or for a greeting or identity question. Otherwise answer as yourself."

  // Peer instructions are intentionally excluded: only the selected bot's
  // instructions govern this reply; peers' jobs are enough for tool routing.
  return `${identity}\n\nTask members:\n${members}\n\n${handoff}\n\nYou are answering this turn as ${JSON.stringify(bot.name)}, ${JSON.stringify(bot.job)}.`
}

function metadataBotId(message: UIMessage) {
  const metadata = message.metadata as { botId?: unknown } | undefined
  return typeof metadata?.botId === "string" ? metadata.botId : undefined
}

function handoffIdentity(part: UIMessage["parts"][number]) {
  if (part.type !== "tool-handoff" || !("output" in part)) return null
  const output = part.output as {
    success?: unknown
    handedOffFrom?: { id?: string } | null
    handedOffTo?: { id?: string }
  } | null
  return output?.success === true ? output : null
}

/** Model-only copies. Never rewrite the persisted transcript or visible text. */
export function attributeBotMessages(
  messages: UIMessage[],
  bots: BotIdentity[]
) {
  return messages.map((message) => {
    if (message.role !== "assistant" && message.role !== "user") return message
    const firstHandoff = message.parts.map(handoffIdentity).find(Boolean)
    let speaker = bots.find(
      (bot) =>
        bot.id ===
        (message.role === "assistant"
          ? (firstHandoff?.handedOffFrom?.id ?? metadataBotId(message))
          : metadataBotId(message))
    )
    let attributed = false

    return {
      ...message,
      parts: message.parts.map((part) => {
        const handoff = handoffIdentity(part)
        if (message.role === "assistant" && handoff?.handedOffTo?.id) {
          speaker = bots.find((bot) => bot.id === handoff.handedOffTo?.id)
          attributed = false
        }
        if (part.type !== "text" || attributed) return part
        attributed = true
        const label = speaker
          ? `${JSON.stringify(speaker.name)} (${JSON.stringify(speaker.job)})`
          : "an unspecified bot"
        const attribution =
          message.role === "assistant"
            ? `[Historical assistant speaker: ${label}]`
            : speaker
              ? `[User addressed: ${label}]`
              : null
        return attribution
          ? { ...part, text: `${attribution}\n${part.text}` }
          : part
      }),
    }
  })
}
