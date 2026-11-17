"use server"

import {
  getWorkspaceConfig,
  saveWorkspaceConfig,
  checkDirEmpty,
  migrateWorkspaceRoot,
  getWorkspaceBinding,
  initialiseWorkspace,
} from "@/lib/workspace.server"
import { getChat } from "@/queries/chats"

// ─── Config ───────────────────────────────────────────────────────────────────

export async function getWorkspaceConfigAction(): Promise<{
  success: true
  rootDir: string | null
} | { success: false; error: string }> {
  try {
    const cfg = await getWorkspaceConfig()
    return { success: true, rootDir: cfg?.rootDir ?? null }
  } catch (err) {
    return { success: false, error: String(err instanceof Error ? err.message : err) }
  }
}

export async function saveWorkspaceConfigAction(rootDir: string): Promise<{
  success: true
} | { success: false; error: string }> {
  if (typeof rootDir !== "string" || !rootDir.trim()) {
    return { success: false, error: "Root directory path is required." }
  }
  try {
    await saveWorkspaceConfig(rootDir.trim())
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err instanceof Error ? err.message : err) }
  }
}

export async function checkDirEmptyAction(dirPath: string): Promise<{
  success: true
  isEmpty: boolean
} | { success: false; error: string }> {
  if (typeof dirPath !== "string" || !dirPath.trim()) {
    return { success: false, error: "Directory path is required." }
  }
  try {
    const isEmpty = await checkDirEmpty(dirPath.trim())
    return { success: true, isEmpty }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function migrateWorkspaceRootAction(newRootDir: string): Promise<{
  success: true
  moved: string[]
  skipped: string[]
  errors: Array<{ chatId: string; message: string }>
} | { success: false; error: string }> {
  if (typeof newRootDir !== "string" || !newRootDir.trim()) {
    return { success: false, error: "Root directory path is required." }
  }
  try {
    const result = await migrateWorkspaceRoot(newRootDir.trim())
    return { success: true, ...result }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export type WorkspaceStatus =
  | { state: "no-config" }
  | { state: "not-initialised"; rootDir: string }
  | { state: "ready"; taskDir: string; rootDir: string }
  | { state: "error"; message: string }

export async function getWorkspaceStatusAction(chatId: string): Promise<WorkspaceStatus> {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return { state: "error", message: "Invalid chat ID." }
  }
  try {
    const cfg = await getWorkspaceConfig()
    if (!cfg) return { state: "no-config" }

    const binding = await getWorkspaceBinding(chatId)
    if (!binding) return { state: "not-initialised", rootDir: cfg.rootDir }

    return { state: "ready", taskDir: binding.taskDir, rootDir: cfg.rootDir }
  } catch (err) {
    return { state: "error", message: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Initialise ───────────────────────────────────────────────────────────────

export async function initialiseWorkspaceAction(chatId: string): Promise<{
  success: true
  taskDir: string
  created: boolean
} | { success: false; error: string }> {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return { success: false, error: "Invalid chat ID." }
  }
  try {
    const chat = await getChat(chatId)
    if (!chat) return { success: false, error: "Chat not found." }
  } catch (err) {
    return { success: false, error: `DB error: ${err instanceof Error ? err.message : String(err)}` }
  }

  try {
    const result = await initialiseWorkspace(chatId)
    return { success: true, ...result }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
