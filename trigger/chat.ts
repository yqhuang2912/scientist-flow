import { openrouter } from "@openrouter/ai-sdk-provider"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import { convertToModelMessages, isStepCount, tool, type ToolSet } from "ai"
import { z } from "zod"

import {
  getChatSkillBindings,
  getTriggerChatContext,
  type TriggerBot,
} from "./bot"
import {
  prepareBotModelHistory,
  botInstructions,
  resolveReplyBot,
} from "../lib/chat-bot-context"
import { botTextTransform } from "../lib/chat-bot-text"

import { pastRead, skillTurn } from "../lib/bot-skill-turn"

const readSkillInput = z.object({
  name: z
    .string()
    .min(1)
    .describe("Exact identifier from your current skill catalog."),
})
const readSkillDefinition = {
  description: "Read an assigned shared skill's SKILL.md for the current task.",
  inputSchema: readSkillInput,
  contextSchema: z.object({ botId: z.string() }),
}
const readSkillSchema = tool({
  ...readSkillDefinition,
  toModelOutput: () => ({ type: "text", value: pastRead }),
})

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

function createHandoffTool(members: TriggerBot[], currentBotId: string) {
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
      return { read_skill: readSkillSchema }
    }

    return { handoff: handoffToolSchema, read_skill: readSkillSchema }
  },
  run: async ({ messages, chatId, clientData, signal, streamText, tools }) => {
    const chatContext = await getTriggerChatContext(chatId)
    const bot = resolveReplyBot(chatContext, clientData?.botId)
    if (!chatContext) throw new Error("Chat not found")

    const turn = skillTurn(await getChatSkillBindings(chatId))
    let responseBotId = bot.id
    const runtimeTools = {
      ...tools,
      ...(chatContext.kind === "group"
        ? { handoff: createHandoffTool(chatContext.bots, bot.id) }
        : {}),
      read_skill: tool({
        ...readSkillDefinition,
        execute: ({ name }, { toolCallId, context }) =>
          turn.read(context.botId, name, toolCallId),
        toModelOutput: ({ toolCallId, output }) => ({
          type: "text",
          value: output.success
            ? (turn.content(toolCallId) ?? pastRead)
            : output.message,
        }),
      }),
    }

    chat.setUIMessageStreamOptions({
      messageMetadata: () => ({ botId: responseBotId }),
    })
    const instructionsFor = (speaker: TriggerBot, allowHandoff: boolean) =>
      [
        systemInstructions,
        botInstructions(speaker, chatContext, {
          handoffAvailable: allowHandoff,
        }),
        turn.catalog(speaker.id),
      ].join("\n\n")

    return streamText({
      model: openrouter("baidu/ernie-5.5-flash-preview:free"),
      system: instructionsFor(bot, true),
      toolsContext: { read_skill: { botId: bot.id } },
      // AI SDK 7 requires explicit opt-in for our server-authored attribution.
      allowSystemInMessages: chatContext.kind === "group",
      messages:
        chatContext.kind === "group"
          ? await convertToModelMessages(
              prepareBotModelHistory(chat.history.all(), chatContext.bots),
              { tools }
            )
          : messages,
      tools: runtimeTools,
      experimental_transform: botTextTransform(chatContext.bots),
      stopWhen: isStepCount(6),
      prepareStep: ({ steps, messages }) => {
        const handoff = [...steps]
          .reverse()
          .flatMap((step) => [...step.toolResults].reverse())
          .find(
            (result) =>
              result.toolName === "handoff" &&
              isSuccessfulHandoff(result.output)
          )

        const transferred =
          handoff && isSuccessfulHandoff(handoff.output)
            ? handoff.output.handedOffTo
            : null
        const target = transferred ?? bot
        responseBotId = target.id
        const hasRead = turn.hasRead(target.id)
        const scopedMessages = transferred
          ? turn.forSpeaker(messages, target.id)
          : messages

        return {
          instructions:
            instructionsFor(target, !transferred) +
            (hasRead
              ? "\nYour read_skill result contains the working procedure for this answer. Deliver the requested artifact using its exact template, including any required literal wording in your visible response. Verify completeness before sending."
              : ""),
          ...(scopedMessages !== messages && { messages: scopedMessages }),
          toolsContext: { read_skill: { botId: target.id } },
          ...(transferred && { activeTools: ["read_skill"] }),
        }
      },
      abortSignal: signal,
    })
  },
})
