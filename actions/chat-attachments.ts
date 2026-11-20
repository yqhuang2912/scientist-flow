"use server"

import { z } from "zod"
import { storedAttachmentSchema } from "@/lib/chat-composer"
import { prepareSavedAttachments } from "@/lib/chat-attachment-context.server"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import { requireWorkspaceBinding } from "@/lib/workspace.server"

export async function prepareChatAttachments(chatId: string, input: unknown) {
  if (process.env.SCIENTISTFLOW_INSTALLATION_ID)
    await assertInstallationRequest()
  const refs = z.array(storedAttachmentSchema).min(1).parse(input)
  const { taskDir } = await requireWorkspaceBinding(chatId)
  return prepareSavedAttachments(taskDir, refs)
}
