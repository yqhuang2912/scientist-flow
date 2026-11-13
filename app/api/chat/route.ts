import { openrouter } from "@openrouter/ai-sdk-provider"
import { convertToModelMessages, streamText, type UIMessage } from "ai"

export async function POST(request: Request) {
  const body = (await request.json()) as { messages?: UIMessage[] }
  const messages = body.messages ?? []

  const result = streamText({
    model: openrouter("baidu/ernie-5.5-flash-preview:free"),
    system:
      "You are a concise, helpful assistant. Answer the user's latest question clearly.",
    messages: await convertToModelMessages(messages),
  })

  return result.toUIMessageStreamResponse()
}
