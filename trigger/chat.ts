import { openrouter } from "@openrouter/ai-sdk-provider"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import { isStepCount, tool, type ToolSet } from "ai"
import { z } from "zod"

import { getTriggerChatContext, type TriggerBot } from "./bot"

const systemInstructions = `You are Scientist Flow, a concise and helpful AI research assistant.

Your job is to help the user think through questions, explain ideas clearly, and make steady progress toward the user's goals.

Your purpose is to be a reliable collaborator: understand the user's intent, give practical answers, and be honest about uncertainty and limitations.

You are running in an isolated sandbox scoped to this chat. Treat the sandbox as the boundary of your working environment, and do not assume access to anything beyond what is explicitly available in the conversation. Do not claim that you performed an action or accessed information unless the conversation provides evidence that it happened.`

function botInstructions(
  bot: TriggerBot | null,
  chatContext: Awaited<ReturnType<typeof getTriggerChatContext>>,
  options: { handoffAvailable?: boolean } = {}
) {
  const identity = bot
    ? [
        `Your name is ${bot.name}.`,
        `Your job is ${bot.job}.`,
        bot.instructions ? `How you should work: ${bot.instructions}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "Respond as the selected bot for this chat."

  if (chatContext?.kind !== "group") {
    return identity
  }

  const members = chatContext.bots
    .map((member, index) => {
      const instructions = member.instructions
        ? `; instructions: ${member.instructions}`
        : ""
      const current = member.id === bot?.id ? " (you)" : ""
      return `${index + 1}. ${member.name}${current} - ${member.job}${instructions}`
    })
    .join("\n")

  const handoffInstructions =
    options.handoffAvailable === false
      ? "You are the target bot for this response. Answer the user's original request directly as yourself. Do not hand off again and do not mention the handoff."
      : "You have one tool: handoff. Call it only when another listed group member is clearly better suited to the user's request. Pass that bot's exact name and a short reason. Never hand off to yourself, do not hand off just to avoid answering, and do not hand off repeatedly. If no handoff is needed, answer directly as yourself."

  return `${identity}

${bot ? `When referring to yourself, use only the name ${bot.name}. Never introduce yourself as another group member.` : ""}

You are participating in a group chat. The group members are:
${members || "- No other bot members are available."}

The identity above is authoritative for this response. Historical assistant messages may have been written by other bots; do not claim to be another bot unless a successful handoff selected that bot for this response.

${handoffInstructions}`
}

const handoffDescription =
  "Pass the user's request to another bot in this group chat when that bot is clearly better suited to answer it."

const handoffInputSchema = z.object({
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
    .describe("Why this bot is better suited to the request."),
})

const handoffToolSchema = tool({
  description: handoffDescription,
  inputSchema: handoffInputSchema,
})

function createHandoffTool(
  members: TriggerBot[],
  currentBotId: string | undefined,
  onHandoff: (botId: string) => void
) {
  let hasHandedOff = false

  return tool({
    description: handoffDescription,
    inputSchema: handoffInputSchema,
    execute: async ({ botName, reason }) => {
      const normalizedName = botName.trim().toLocaleLowerCase()
      const matches = members.filter(
        (member) => member.name.trim().toLocaleLowerCase() === normalizedName
      )

      if (matches.length === 0) {
        return {
          success: false,
          message: `That bot is not a member of this group chat. Choose one of: ${members
            .map((member) => member.name)
            .join(", ")}.`,
        }
      }

      if (matches.length > 1) {
        return {
          success: false,
          message:
            "Multiple group members have that name. Choose a member with a unique name.",
        }
      }

      const target = matches[0]

      if (target.id === currentBotId) {
        return {
          success: false,
          message: "You cannot hand off to yourself. Answer the user directly.",
        }
      }

      if (hasHandedOff) {
        return {
          success: false,
          message:
            "Only one handoff is allowed for each response. Answer the user directly.",
        }
      }

      hasHandedOff = true
      onHandoff(target.id)

      const source =
        members.find((member) => member.id === currentBotId) ?? null

      return {
        success: true,
        handedOffFrom: source,
        handedOffTo: {
          id: target.id,
          name: target.name,
          job: target.job,
          instructions: target.instructions,
        },
        reason,
        instruction: `Answer the user's original request as ${target.name}, using that bot's job and instructions. Do not mention this handoff.`,
      }
    },
  })
}

type HandoffOutput = {
  success: true
  handedOffFrom?: TriggerBot | null
  handedOffTo: TriggerBot
}

function isSuccessfulHandoff(value: unknown): value is HandoffOutput {
  if (!value || typeof value !== "object") {
    return false
  }

  const output = value as Partial<HandoffOutput>
  const source = output.handedOffFrom
  const target = output.handedOffTo

  return (
    output.success === true &&
    (source === undefined ||
      source === null ||
      (typeof source === "object" &&
        typeof source.id === "string" &&
        typeof source.name === "string" &&
        typeof source.job === "string" &&
        (typeof source.instructions === "string" ||
          source.instructions === null))) &&
    !!target &&
    typeof target === "object" &&
    typeof target.id === "string" &&
    typeof target.name === "string" &&
    typeof target.job === "string" &&
    (typeof target.instructions === "string" || target.instructions === null)
  )
}

export const chatAgent = chat.agent({
  id: "chat-agent",
  storage: defaultStorage,
  clientDataSchema: z.object({
    botId: z.string().min(1).optional(),
  }),
  tools: async ({ chatId }): Promise<ToolSet> => {
    const chatContext = await getTriggerChatContext(chatId)

    if (chatContext?.kind !== "group") {
      return {}
    }

    return { handoff: handoffToolSchema }
  },
  run: async ({ messages, chatId, clientData, signal, streamText, tools }) => {
    const chatContext = await getTriggerChatContext(chatId)
    const bot =
      chatContext?.bots.find(
        (candidate) => candidate.id === clientData?.botId
      ) ??
      chatContext?.bots[0] ??
      null

    let responseBotId = bot?.id
    const runtimeTools =
      chatContext?.kind === "group"
        ? {
            ...tools,
            handoff: createHandoffTool(chatContext.bots, bot?.id, (botId) => {
              responseBotId = botId
            }),
          }
        : tools

    if (responseBotId) {
      chat.setUIMessageStreamOptions({
        messageMetadata: () => ({ botId: responseBotId }),
      })
    }

    const system = `${systemInstructions}\n\n${botInstructions(bot, chatContext)}`

    return streamText({
      model: openrouter("baidu/ernie-5.5-flash-preview:free"),
      system,
      messages,
      tools: runtimeTools,
      stopWhen: chatContext?.kind === "group" ? isStepCount(3) : undefined,
      prepareStep: ({ steps }) => {
        const handoff = [...steps]
          .reverse()
          .flatMap((step) => [...step.toolResults].reverse())
          .find(
            (result) =>
              result.toolName === "handoff" &&
              isSuccessfulHandoff(result.output)
          )

        if (!handoff || !isSuccessfulHandoff(handoff.output)) {
          return {}
        }

        const target = handoff.output.handedOffTo
        responseBotId = target.id

        return {
          system: `${systemInstructions}\n\n${botInstructions(
            target,
            chatContext,
            { handoffAvailable: false }
          )}`,
          activeTools: [],
        }
      },
      abortSignal: signal,
    })
  },
})
