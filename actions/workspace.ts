"use server"

import {
  getWorkspaceConfig,
  saveWorkspaceConfig,
  checkDirEmpty,
  migrateWorkspaceRoot,
  getWorkspaceBinding,
  initialiseWorkspace,
  createWorkspaceDirectory,
  inspectWorkspaceDirectoryForDeletion,
  deleteWorkspaceDirectory,
  createWorkspaceFile,
  inspectWorkspaceEntryForRename,
  renameWorkspaceEntry,
  inspectWorkspaceFileForDeletion,
  deleteWorkspaceFile,
} from "@/lib/workspace.server"
import { getChat } from "@/queries/chats"
import { WORKSPACE_LAYOUT_VERSION } from "@/lib/workspace-layout.server"
import {
  directoryError,
  resolveWorkspaceDirectory,
} from "@/lib/workspace-directory.server"
import {
  workspaceRootFormSchema,
  workspaceChatIdSchema,
  workspaceRelativePathSchema,
  workspaceDirectoryTargetSchema,
  createWorkspaceDirectorySchema,
  deleteWorkspaceDirectorySchema,
  type DirectoryDeletionConfirmation,
  createWorkspaceFileSchema,
  workspaceFileTargetSchema,
  deleteWorkspaceFileSchema,
  renameWorkspaceEntrySchema,
  type FileDeletionConfirmation,
} from "@/lib/workspace-validation"
import { fileError } from "@/lib/workspace-file.server"

// ─── Config ───────────────────────────────────────────────────────────────────

export async function getWorkspaceConfigAction(): Promise<
  | {
      success: true
      rootDir: string | null
    }
  | { success: false; error: string }
> {
  try {
    const cfg = await getWorkspaceConfig()
    return { success: true, rootDir: cfg?.rootDir ?? null }
  } catch (err) {
    return {
      success: false,
      error: String(err instanceof Error ? err.message : err),
    }
  }
}

export async function saveWorkspaceConfigAction(rootDir: string): Promise<
  | {
      success: true
    }
  | { success: false; error: string }
> {
  const parsed = workspaceRootFormSchema.safeParse({ rootDir })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }
  try {
    await saveWorkspaceConfig(parsed.data.rootDir)
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: String(err instanceof Error ? err.message : err),
    }
  }
}

export async function checkDirEmptyAction(dirPath: string): Promise<
  | {
      success: true
      isEmpty: boolean
    }
  | { success: false; error: string }
> {
  const parsed = workspaceRootFormSchema.safeParse({ rootDir: dirPath })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }
  try {
    const isEmpty = await checkDirEmpty(parsed.data.rootDir)
    return { success: true, isEmpty }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function migrateWorkspaceRootAction(newRootDir: string): Promise<
  | {
      success: true
      moved: string[]
      skipped: string[]
      errors: Array<{ chatId: string; message: string }>
    }
  | { success: false; error: string }
> {
  const parsed = workspaceRootFormSchema.safeParse({ rootDir: newRootDir })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }
  try {
    const result = await migrateWorkspaceRoot(parsed.data.rootDir)
    return { success: true, ...result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export type WorkspaceStatus =
  | { state: "no-config" }
  | { state: "not-initialised"; rootDir: string }
  | { state: "ready"; taskDir: string; rootDir: string }
  | { state: "error"; message: string }

export async function getWorkspaceStatusAction(
  chatId: string
): Promise<WorkspaceStatus> {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return { state: "error", message: "Invalid chat ID." }
  }
  try {
    workspaceChatIdSchema.parse(chatId)
    if (!(await getChat(chatId)))
      return { state: "error", message: "聊天不存在或不可访问。" }
    const cfg = await getWorkspaceConfig()
    if (!cfg) return { state: "no-config" }

    const binding = await getWorkspaceBinding(chatId)
    if (!binding) return { state: "not-initialised", rootDir: cfg.rootDir }

    await resolveWorkspaceDirectory(binding.taskDir, "")
    if ((binding.layoutVersion ?? 1) < WORKSPACE_LAYOUT_VERSION)
      await initialiseWorkspace(chatId)

    return { state: "ready", taskDir: binding.taskDir, rootDir: cfg.rootDir }
  } catch (err) {
    return {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function createWorkspaceDirectoryAction(
  chatId: string,
  parentRelativePath: string,
  name: string
) {
  const input = createWorkspaceDirectorySchema.safeParse({ name })
  if (!input.success)
    return {
      success: false as const,
      code: "INVALID",
      error: input.error.issues[0].message,
    }
  try {
    workspaceChatIdSchema.parse(chatId)
    const parent = workspaceRelativePathSchema.parse(parentRelativePath)
    const entry = await createWorkspaceDirectory(
      chatId,
      parent,
      input.data.name
    )
    return { success: true as const, entry }
  } catch (error) {
    return { success: false as const, ...directoryError(error) }
  }
}

export async function inspectWorkspaceDirectoryForDeletionAction(
  chatId: string,
  relativePath: string
) {
  try {
    workspaceChatIdSchema.parse(chatId)
    const relative = workspaceDirectoryTargetSchema.parse(relativePath)
    const inspection = await inspectWorkspaceDirectoryForDeletion(
      chatId,
      relative
    )
    return { success: true as const, inspection }
  } catch (error) {
    return { success: false as const, ...directoryError(error) }
  }
}

export async function deleteWorkspaceDirectoryAction(
  chatId: string,
  relativePath: string,
  confirmation: DirectoryDeletionConfirmation
) {
  try {
    workspaceChatIdSchema.parse(chatId)
    const relative = workspaceDirectoryTargetSchema.parse(relativePath)
    const checked = deleteWorkspaceDirectorySchema.parse(confirmation)
    await deleteWorkspaceDirectory(chatId, relative, checked)
    return { success: true as const }
  } catch (error) {
    return { success: false as const, ...directoryError(error) }
  }
}

export async function createWorkspaceFileAction(
  chatId: string,
  parentRelativePath: string,
  name: string
) {
  const input = createWorkspaceFileSchema.safeParse({ name })
  if (!input.success)
    return {
      success: false as const,
      code: "INVALID",
      error: input.error.issues[0].message,
    }
  try {
    workspaceChatIdSchema.parse(chatId)
    const parent = workspaceRelativePathSchema.parse(parentRelativePath)
    const entry = await createWorkspaceFile(chatId, parent, input.data.name)
    return { success: true as const, entry }
  } catch (error) {
    return { success: false as const, ...fileError(error) }
  }
}

export async function inspectWorkspaceEntryForRenameAction(
  chatId: string,
  relativePath: string
) {
  try {
    workspaceChatIdSchema.parse(chatId)
    const target = workspaceFileTargetSchema.parse(relativePath)
    return await inspectWorkspaceEntryForRename(chatId, target)
  } catch (error) {
    throw new Error(fileError(error).error)
  }
}

export async function renameWorkspaceEntryAction(
  chatId: string,
  relativePath: string,
  name: string,
  identity: string
) {
  const input = renameWorkspaceEntrySchema.safeParse({
    confirmed: true,
    identity,
    name,
  })
  if (!input.success)
    return {
      success: false as const,
      code: "INVALID",
      error: input.error.issues[0].message,
    }
  try {
    workspaceChatIdSchema.parse(chatId)
    const target = workspaceFileTargetSchema.parse(relativePath)
    const entry = await renameWorkspaceEntry(chatId, target, input.data)
    return { success: true as const, entry }
  } catch (error) {
    return { success: false as const, ...fileError(error) }
  }
}

export async function inspectWorkspaceFileForDeletionAction(
  chatId: string,
  relativePath: string
) {
  try {
    workspaceChatIdSchema.parse(chatId)
    const relative = workspaceFileTargetSchema.parse(relativePath)
    const inspection = await inspectWorkspaceFileForDeletion(chatId, relative)
    return { success: true as const, inspection }
  } catch (error) {
    return { success: false as const, ...fileError(error) }
  }
}

export async function deleteWorkspaceFileAction(
  chatId: string,
  relativePath: string,
  confirmation: FileDeletionConfirmation
) {
  try {
    workspaceChatIdSchema.parse(chatId)
    const relative = workspaceFileTargetSchema.parse(relativePath)
    const checked = deleteWorkspaceFileSchema.parse(confirmation)
    await deleteWorkspaceFile(chatId, relative, checked)
    return { success: true as const }
  } catch (error) {
    return { success: false as const, ...fileError(error) }
  }
}

// ─── Initialise ───────────────────────────────────────────────────────────────

export async function initialiseWorkspaceAction(chatId: string): Promise<
  | {
      success: true
      taskDir: string
      created: boolean
    }
  | { success: false; error: string }
> {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return { success: false, error: "Invalid chat ID." }
  }
  try {
    const chat = await getChat(chatId)
    if (!chat) return { success: false, error: "Chat not found." }
  } catch (err) {
    return {
      success: false,
      error: `DB error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  try {
    const result = await initialiseWorkspace(chatId)
    return { success: true, ...result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
