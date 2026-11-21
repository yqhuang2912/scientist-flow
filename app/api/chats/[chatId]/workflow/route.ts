import { getChat } from "@/queries/chats"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import { ModelConnectionError } from "@/lib/model-credentials.server"
import { startWorkflow } from "@/lib/workflow-run.server"
import { TurnConflict } from "@/lib/chat-jobs.server"
import { wakeChatWorker } from "@/lib/chat-worker.server"

export const runtime = "nodejs"
export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  try {
    await assertInstallationRequest()
    const chat = await getChat((await context.params).chatId)
    if (!chat) return new Response("Chat not found.", { status: 404 })
    const receipt = await startWorkflow(
      chat,
      new URL(request.url).searchParams.get("retry") === "rate-limit"
    )
    wakeChatWorker()
    return Response.json(receipt)
  } catch (error) {
    if (error instanceof TurnConflict || error instanceof ModelConnectionError)
      return new Response(error.message, {
        status: error instanceof TurnConflict ? 409 : 403,
      })
    return new Response("Could not start the workflow.", { status: 500 })
  }
}
