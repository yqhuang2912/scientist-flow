import { getChat } from "@/queries/chats"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import { ModelConnectionError } from "@/lib/model-credentials.server"
import { startWorkflow } from "@/lib/workflow-run.server"
import { TurnConflict } from "@/lib/chat-jobs.server"
import { wakeChatWorker } from "@/lib/chat-worker.server"

import { checkpointCommand } from "@/lib/workflow-checkpoint"
import { changeCheckpoint } from "@/lib/workflow-checkpoint.server"
import { workflowTurnId } from "@/lib/workflow-subset"

export const runtime = "nodejs"
async function handle(
  request: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  try {
    await assertInstallationRequest()
    const chat = await getChat((await context.params).chatId)
    if (!chat) return new Response("Chat not found.", { status: 404 })
    const body = await request.text()
    let input: unknown
    if (body) {
      try {
        input = JSON.parse(body)
      } catch {
        return new Response("Invalid checkpoint instruction.", { status: 400 })
      }
    }
    const command = body ? checkpointCommand.safeParse(input) : undefined
    if (
      (command && !command.success) ||
      (!command && request.method === "PATCH")
    )
      return new Response("Invalid checkpoint instruction.", { status: 400 })
    if (
      command?.success &&
      command.data.action === "submit" &&
      command.data.mentionedBotIds?.some(
        (id) => !chat.bots.some((bot) => bot.id === id)
      )
    ) {
      return new Response("Select bots from this group.", { status: 400 })
    }
    if (request.method === "PATCH" && command && command.success) {
      if (!chat.template)
        throw new TurnConflict("No template is bound to this group.")
      const checkpoint = await changeCheckpoint(
        chat.id,
        workflowTurnId(chat.template.id),
        command.data
      )
      wakeChatWorker()
      return Response.json(checkpoint)
    }
    const receipt = await startWorkflow(
      chat,
      new URL(request.url).searchParams.get("retry") === "rate-limit",
      command ? command.data : undefined
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

export { handle as POST, handle as PATCH }
