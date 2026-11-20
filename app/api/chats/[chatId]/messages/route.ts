import { createUIMessageStreamResponse } from "ai"
import { getChat } from "@/queries/chats"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import { ModelConnectionError } from "@/lib/model-credentials.server"
import {
  nativeChatMember,
  nativeTurnInput,
  NativeTurnConflict,
} from "@/lib/native-direct-chat"
import { nativeDirectReply } from "@/lib/native-direct-chat.server"

export const runtime = "nodejs"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    await assertInstallationRequest()
    const { chatId } = await params
    const chat = await getChat(chatId)
    if (!chat || !nativeChatMember(chat))
      return new Response("Native chat not found.", { status: 404 })
    const input = nativeTurnInput.safeParse(
      await request.json().catch(() => null)
    )
    if (!input.success)
      return new Response("Send one text message with a valid message ID.", {
        status: 400,
      })
    if (input.data.botId !== chat.bots[0].id)
      return new Response("This bot is not a member of the chat.", {
        status: 403,
      })
    const stream = await nativeDirectReply(chat, input.data, request.signal)
    return createUIMessageStreamResponse({ stream })
  } catch (error) {
    if (error instanceof NativeTurnConflict)
      return new Response(error.message, { status: 409 })
    if (error instanceof ModelConnectionError)
      return new Response(error.message, { status: 403 })
    return new Response("Could not start the local chat turn.", { status: 500 })
  }
}
