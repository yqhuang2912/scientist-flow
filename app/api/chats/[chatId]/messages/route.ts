import { getChat } from "@/queries/chats"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import {
  installationOwner,
  ModelConnectionError,
} from "@/lib/model-credentials.server"
import { chatJobInput } from "@/lib/chat-job"
import {
  cancelChatTurn,
  chatSnapshot,
  enqueueChatTurn,
  turnProgress,
  TurnConflict,
} from "@/lib/chat-jobs.server"
import { textEventResponse } from "@/lib/chat-live.server"
import { isActiveTurn } from "@/lib/chat-job"
import { wakeChatWorker } from "@/lib/chat-worker.server"

export const runtime = "nodejs"
type Context = { params: Promise<{ chatId: string }> }

async function handle(request: Request, { params }: Context) {
  try {
    await assertInstallationRequest()
    installationOwner()
    const { chatId } = await params
    const turnId = new URL(request.url).searchParams.get("id")
    if (request.method === "GET" && turnId) {
      const progress = await turnProgress(chatId, turnId)
      if (progress && request.headers.get("accept")?.includes("text/event-stream"))
        return isActiveTurn(progress.state)
          ? textEventResponse(chatId, turnId, request.signal)
          : new Response(null, { status: 204 })
      return progress
        ? Response.json(progress, { headers: { "Cache-Control": "no-store" } })
        : new Response("Turn not found.", { status: 404 })
    }
    const chat = await getChat(chatId)
    if (!chat) return new Response("Chat not found.", { status: 404 })
    if (request.method === "POST") {
      const input = chatJobInput.safeParse(
        await request.json().catch(() => null)
      )
      if (!input.success)
        return new Response("Invalid chat message.", { status: 400 })
      const members = new Set(chat.bots.map((bot) => bot.id))
      if (
        !(input.data.mentionedBotIds ?? [input.data.botId]).every((id) =>
          members.has(id)
        )
      )
        return new Response("This bot is not a member of this chat.", {
          status: 403,
        })
      const ack = await enqueueChatTurn(chatId, input.data)
      wakeChatWorker()
      return Response.json(ack, { headers: { "Cache-Control": "no-store" } })
    } else if (request.method === "DELETE") {
      if (!turnId) return new Response("Missing message ID.", { status: 400 })
      await cancelChatTurn(chatId, turnId)
      wakeChatWorker()
      return new Response(null, { status: 204 })
    }
    return Response.json(await chatSnapshot(chatId), {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (e) {
    if (e instanceof TurnConflict)
      return new Response(e.message, { status: 409 })
    if (e instanceof ModelConnectionError)
      return new Response(e.message, { status: 403 })
    return new Response("Could not access this chat turn.", { status: 500 })
  }
}
export { handle as GET, handle as POST, handle as DELETE }
