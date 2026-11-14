import { openrouter } from "@openrouter/ai-sdk-provider"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"

export const chatAgent = chat.agent({
  id: "chat-agent",
  storage: defaultStorage,
  run: async ({ messages, signal, streamText }) =>
    streamText({
      model: openrouter("baidu/ernie-5.5-flash-preview:free"),
      system:
        "You are a concise, helpful assistant. Answer the user's latest question clearly.",
      messages,
      abortSignal: signal,
    }),
})
