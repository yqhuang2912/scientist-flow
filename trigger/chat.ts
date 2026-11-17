import { openrouter } from "@openrouter/ai-sdk-provider"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import { convertToModelMessages, isStepCount, tool, type ToolSet } from "ai"
import { z } from "zod"

import { getTriggerChatContext, type TriggerBot } from "./bot"
import {
  prepareBotModelHistory,
  botInstructions,
  resolveReplyBot,
} from "../lib/chat-bot-context"
import { botTextTransform } from "../lib/chat-bot-text"

const systemInstructions = `You are a bot in Scientist Flow. Use the current bot identity specified below.

Your job is to help the user think through questions, explain ideas clearly, and make steady progress toward the user's goals.

Your purpose is to be a reliable collaborator: understand the user's intent, give practical answers, and be honest about uncertainty and limitations.

You are running in an isolated sandbox scoped to this chat. Treat the sandbox as the boundary of your working environment, and do not assume access to anything beyond what is explicitly available in the conversation. Do not claim that you performed an action or accessed information unless the conversation provides evidence that it happened.`

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
    const bot = resolveReplyBot(chatContext, clientData?.botId)
    if (!chatContext) throw new Error("Chat not found")

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
      // AI SDK 7 requires explicit opt-in for our server-authored attribution.
      allowSystemInMessages: chatContext.kind === "group",
      messages:
        chatContext.kind === "group"
          ? await convertToModelMessages(
              prepareBotModelHistory(chat.history.all(), chatContext.bots),
              { tools: runtimeTools }
            )
          : messages,
      tools: runtimeTools,
      experimental_transform: botTextTransform(chatContext.bots),
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
