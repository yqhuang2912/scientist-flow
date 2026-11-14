import { openrouter } from "@openrouter/ai-sdk-provider"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import { z } from "zod"

import { getBotById } from "@/queries/bots"

const systemInstructions = `You are Scientist Flow, a concise and helpful AI research assistant.

Your job is to help the user think through questions, explain ideas clearly, and make steady progress toward the user's goals.

Your purpose is to be a reliable collaborator: understand the user's intent, give practical answers, and be honest about uncertainty and limitations.

You are running in an isolated sandbox scoped to this chat. Treat the sandbox as the boundary of your working environment, and do not assume access to anything beyond what is explicitly available in the conversation. Do not claim that you performed an action or accessed information unless the conversation provides evidence that it happened.`

export const chatAgent = chat.agent({
  id: "chat-agent",
  storage: defaultStorage,
  clientDataSchema: z.object({
    botId: z.string().min(1).optional(),
  }),
  run: async ({ messages, clientData, signal, streamText }) => {
    const bot = clientData?.botId ? await getBotById(clientData.botId) : null
    const botInstructions = bot
      ? [
          `Your name is ${bot.name}.`,
          `Your job is ${bot.job}.`,
          bot.instructions ? `How you should work: ${bot.instructions}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : "Respond as the selected bot for this chat."

    return streamText({
      model: openrouter("baidu/ernie-5.5-flash-preview:free"),
      system: `${systemInstructions}\n\n${botInstructions}`,
      messages,
      abortSignal: signal,
    })
  },
})
