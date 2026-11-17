"use server"

import { headers } from "next/headers"
import {
  requireWorkspaceBinding,
  withDirectoryWrite,
} from "@/lib/workspace.server"
import { getChat } from "@/queries/chats"
import { resolveWorkspaceFile } from "@/lib/workspace-file.server"
import { WorkspaceDirectoryError } from "@/lib/workspace-directory.server"
import {
  readTextInWorkspace,
  saveTextInWorkspace,
} from "@/lib/workspace-text.server"
import {
  isLocalDesktopRequest,
  requestDesktopOpen,
} from "@/lib/workspace-desktop.server"
import { workspaceOpenPolicy } from "@/lib/workspace-open-policy"
import {
  documentTargetSchema,
  saveDocumentSchema,
  type DocumentTarget,
  type SaveDocumentInput,
  type DocumentResult,
  type OpenedDocument,
  type TextDocument,
  type DocumentFailure,
} from "@/lib/workspace-document"

function failure(error: unknown): DocumentFailure {
  if (error instanceof WorkspaceDirectoryError)
    return { success: false, code: error.code, error: error.message }
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === "ENOENT")
    return {
      success: false,
      code: "NOT_FOUND",
      error: "The file no longer exists. Your draft has been kept.",
    }
  return {
    success: false,
    code: "IO_ERROR",
    error:
      "Cannot access this file. Check the path and permissions, then retry.",
  }
}

export async function readWorkspaceDocumentAction(
  input: DocumentTarget
): Promise<DocumentResult<OpenedDocument>> {
  try {
    const target = documentTargetSchema.parse(input)
    const binding = await requireWorkspaceBinding(target.chatId)
    const chat = await getChat(target.chatId)
    const data = await readTextInWorkspace(binding.taskDir, target.relativePath)
    return {
      success: true,
      data: {
        ...target,
        ...data,
        taskName: chat?.name ?? chat?.bot?.name ?? "Task",
      },
    }
  } catch (error) {
    return failure(error)
  }
}

export async function saveWorkspaceDocumentAction(
  input: SaveDocumentInput
): Promise<DocumentResult<TextDocument>> {
  const parsed = saveDocumentSchema.safeParse(input)
  if (!parsed.success)
    return {
      success: false,
      code: "INVALID",
      error: parsed.error.issues[0].message,
    }
  try {
    const { chatId, relativePath, content, baseVersion } = parsed.data
    const data = await withDirectoryWrite(chatId, async () => {
      const binding = await requireWorkspaceBinding(chatId)
      return saveTextInWorkspace(
        binding.taskDir,
        relativePath,
        content,
        baseVersion
      )
    })
    return { success: true, data }
  } catch (error) {
    return failure(error)
  }
}

const launches = new Map<
  string,
  { at: number; pending: boolean; request: Promise<void> }
>()
export async function openWorkspaceExternalAction(
  input: DocumentTarget
): Promise<DocumentResult<null>> {
  try {
    const target = documentTargetSchema.parse(input)
    await requireWorkspaceBinding(target.chatId)
    if (workspaceOpenPolicy(target.relativePath).kind !== "external")
      throw new WorkspaceDirectoryError(
        "UNSUPPORTED",
        "This file cannot be opened with a system application."
      )
    if (!isLocalDesktopRequest(await headers()))
      throw new WorkspaceDirectoryError(
        "DESKTOP_UNAVAILABLE",
        "System opening is unavailable. It requires a Windows desktop deployment with local opening enabled."
      )
    const key = `${target.chatId}/${target.relativePath.toLowerCase()}`
    const now = Date.now()
    for (const [item, launch] of launches)
      if (!launch.pending && now - launch.at > 3000) launches.delete(item)
    const previous = launches.get(key)
    if (previous) {
      await previous.request
      return { success: true, data: null }
    }
    const request = withDirectoryWrite(target.chatId, async () => {
      const current = await requireWorkspaceBinding(target.chatId)
      const file = await resolveWorkspaceFile(
        current.taskDir,
        target.relativePath
      )
      await requestDesktopOpen(file.absolute)
    })
    const launch = { at: now, pending: true, request }
    launches.set(key, launch)
    try {
      await request
      launch.pending = false
      launch.at = Date.now()
    } catch (error) {
      launches.delete(key)
      throw error
    }
    // No filesystem body read, no wait for the external application to exit.
    return { success: true, data: null }
  } catch (error) {
    return failure(error)
  }
}
