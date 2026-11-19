import "server-only"

import {
  createFileInWorkspace,
  inspectFileInWorkspace,
  deleteFileInWorkspace,
  uploadFileToWorkspace,
} from "./workspace-file.server"
import {
  ensureUploadsDirectory,
} from "./workspace-directory.server"
import { UPLOADS_DIR } from "./workspace-validation"
import type { FileDeletionConfirmation } from "./workspace-validation"

import fs from "node:fs/promises"
import path from "node:path"
import {
  assertEmptyWorkspaceRoot,
  isWorkspaceRootEmpty,
} from "./workspace-root.server"
import { getChat } from "@/queries/chats"
import {
  createDirectoryInWorkspace,
  deleteDirectoryInWorkspace,
  inspectDirectoryInWorkspace,
  resolveWorkspaceDirectory,
  WorkspaceDirectoryError,
} from "@/lib/workspace-directory.server"
import {
  workspaceChatIdSchema,
  type DirectoryDeletionConfirmation,
} from "@/lib/workspace-validation"

const CONFIG_FILE = path.join(process.cwd(), "workspace.local.json")

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkspaceConfig {
  /** Absolute path to the root directory where task workspaces live. */
  rootDir: string
}

export interface WorkspaceBinding {
  /** The resolved absolute path that was used when this chat was initialised. */
  taskDir: string
  /** ISO timestamp of when the workspace was first initialised. */
  initialisedAt: string
}

export interface WorkspaceLocalFile {
  config?: WorkspaceConfig
  /** Map of chatId → binding, set at initialisation time. */
  bindings?: Record<string, WorkspaceBinding>
}

export interface FsEntry {
  name: string
  isDir: boolean
  isFile: boolean
  /** Relative path from the task root, using forward slashes. */
  relPath: string
}

// ─── Config persistence ───────────────────────────────────────────────────────

async function readLocalFile(): Promise<WorkspaceLocalFile> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object") {
      return parsed as WorkspaceLocalFile
    }
    return {}
  } catch (err: unknown) {
    // File absent → empty config. Any other error is surfaced.
    if (isNodeError(err) && err.code === "ENOENT") {
      return {}
    }
    throw new Error(
      `Failed to read workspace config: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

async function writeLocalFile(data: WorkspaceLocalFile): Promise<void> {
  // Write to a temp file then rename to avoid half-writes.
  const tmp = `${CONFIG_FILE}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8")
    await fs.rename(tmp, CONFIG_FILE)
  } catch (err: unknown) {
    // Clean up temp file on failure
    await fs.unlink(tmp).catch(() => undefined)
    throw new Error(
      `Failed to save workspace config: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

// ─── Public: config ────────────────────────────────────────────────────────────

export async function getWorkspaceConfig(): Promise<WorkspaceConfig | null> {
  const file = await readLocalFile()
  return file.config ?? null
}

export async function saveWorkspaceConfig(rootDir: string): Promise<void> {
  const resolved = resolveAndNormalise(rootDir)
  await assertIsAccessibleDir(resolved)
  const file = await readLocalFile()
  await assertEmptyWorkspaceRoot(resolved)
  await writeLocalFile({ ...file, config: { rootDir: resolved } })
}

/** Returns true when the directory exists and has no entries. */
export async function checkDirEmpty(absPath: string): Promise<boolean> {
  const resolved = resolveAndNormalise(absPath)
  await assertIsAccessibleDir(resolved)
  return isWorkspaceRootEmpty(resolved)
}

/**
 * Change the workspace root and migrate every bound task directory into the
 * new root. For each bound chat:
 *   1. Move <oldRoot>/<chatId> → <newRoot>/<chatId>  (fs.rename, falls back to
 *      copy+delete when crossing volumes).
 *   2. Update the binding's taskDir in the config file.
 *
 * The operation is NOT atomic across chats — if it fails mid-way, the config
 * file is updated with whatever was successfully moved. A new destination
 * must be empty before any task directory is moved.
 */
export async function migrateWorkspaceRoot(newRootDir: string): Promise<{
  moved: string[]
  skipped: string[]
  errors: Array<{ chatId: string; message: string }>
}> {
  const newRoot = resolveAndNormalise(newRootDir)
  await assertIsAccessibleDir(newRoot)

  const file = await readLocalFile()
  await assertEmptyWorkspaceRoot(newRoot)

  const moved: string[] = []
  const skipped: string[] = []
  const errors: Array<{ chatId: string; message: string }> = []

  const updatedBindings: Record<string, WorkspaceBinding> = {
    ...(file.bindings ?? {}),
  }

  for (const [chatId, binding] of Object.entries(file.bindings ?? {})) {
    const oldTaskDir = binding.taskDir
    const newTaskDir = path.join(newRoot, chatId)

    // Already at the new location (e.g. retry after partial migration)
    if (normalise(oldTaskDir) === normalise(newTaskDir)) {
      skipped.push(chatId)
      continue
    }

    try {
      // Verify source still exists
      const srcStat = await fs.lstat(oldTaskDir).catch(() => null)
      if (!srcStat) {
        // Source gone — just update the binding to new expected location
        updatedBindings[chatId] = { ...binding, taskDir: newTaskDir }
        skipped.push(chatId)
        continue
      }

      // Ensure target parent exists
      await fs.mkdir(newRoot, { recursive: true })

      // Try a rename first (fast, same-volume)
      try {
        await fs.rename(oldTaskDir, newTaskDir)
      } catch (renameErr: unknown) {
        // EXDEV = cross-device rename not permitted → copy then delete
        if (isNodeError(renameErr) && renameErr.code === "EXDEV") {
          await copyDirRecursive(oldTaskDir, newTaskDir)
          await fs.rm(oldTaskDir, { recursive: true, force: true })
        } else {
          throw renameErr
        }
      }

      updatedBindings[chatId] = { ...binding, taskDir: newTaskDir }
      moved.push(chatId)
    } catch (err: unknown) {
      errors.push({
        chatId,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Persist updated bindings + new root regardless of partial failures
  await writeLocalFile({
    ...file,
    config: { rootDir: newRoot },
    bindings: updatedBindings,
  })

  return { moved, skipped, errors }
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

function normalise(p: string): string {
  const isWindows = process.platform === "win32"
  return path.normalize(isWindows ? p.toLowerCase() : p)
}

// ─── Public: binding ──────────────────────────────────────────────────────────

export async function getWorkspaceBinding(
  chatId: string
): Promise<WorkspaceBinding | null> {
  assertSafeChatId(chatId)
  const file = await readLocalFile()
  return file.bindings?.[chatId] ?? null
}

// ─── Public: initialise ───────────────────────────────────────────────────────

export async function initialiseWorkspace(chatId: string): Promise<{
  taskDir: string
  created: boolean
}> {
  assertSafeChatId(chatId)

  const file = await readLocalFile()
  if (!file.config?.rootDir) {
    throw new Error("Workspace root directory is not configured.")
  }

  const rootDir = resolveAndNormalise(file.config.rootDir)
  await assertIsAccessibleDir(rootDir)

  // If already bound, return the existing binding (idempotent).
  const existing = file.bindings?.[chatId]
  if (existing) {
    // Re-verify the bound dir still exists and is a directory.
    await assertIsAccessibleDir(existing.taskDir)
    return { taskDir: existing.taskDir, created: false }
  }

  const taskDir = path.join(rootDir, chatId)

  // Check for a plain file at the expected location.
  try {
    const stat = await fs.stat(taskDir)
    if (!stat.isDirectory()) {
      throw new Error(
        `A file already exists at ${taskDir}. Remove it before initialising this workspace.`
      )
    }
  } catch (err: unknown) {
    if (!isNodeError(err) || err.code !== "ENOENT") {
      throw err
    }
  }

  const subdirs = [
    "src",
    "data",
    "docs",
    "outputs",
    path.join("outputs", "figures"),
    path.join("outputs", "checkpoints"),
  ]

  await fs.mkdir(taskDir, { recursive: true })
  for (const sub of subdirs) {
    await fs.mkdir(path.join(taskDir, sub), { recursive: true })
  }

  const binding: WorkspaceBinding = {
    taskDir,
    initialisedAt: new Date().toISOString(),
  }

  await writeLocalFile({
    ...file,
    bindings: { ...file.bindings, [chatId]: binding },
  })

  return { taskDir, created: true }
}

// ─── Public: list directory ───────────────────────────────────────────────────

const MAX_ENTRIES = 200

// Reuse the same chat lookup as the existing page/actions. This local app has
// no separate user/session ACL; do not introduce a second access policy here.
export async function requireWorkspaceBinding(
  chatId: string
): Promise<WorkspaceBinding> {
  workspaceChatIdSchema.parse(chatId)
  if (!(await getChat(chatId)))
    throw new WorkspaceDirectoryError(
      "CHAT_NOT_FOUND",
      "聊天不存在或不可访问。"
    )
  const binding = await getWorkspaceBinding(chatId)
  if (!binding)
    throw new WorkspaceDirectoryError(
      "NOT_INITIALISED",
      "当前任务尚未初始化工作区。"
    )
  return binding
}

// Serialise writes to the same chat in this server process, including ancestor
// deletion vs child creation. Other chats and chat streaming remain independent.
const directoryWrites = new Map<string, Promise<unknown>>()
export async function withDirectoryWrite<T>(
  chatId: string,
  operation: () => Promise<T>
): Promise<T> {
  workspaceChatIdSchema.parse(chatId)
  const previous = directoryWrites.get(chatId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  directoryWrites.set(chatId, next)
  try {
    return await next
  } finally {
    if (directoryWrites.get(chatId) === next) directoryWrites.delete(chatId)
  }
}

export async function createWorkspaceDirectory(
  chatId: string,
  parentRelativePath: string,
  name: string
) {
  return withDirectoryWrite(chatId, async () => {
    const binding = await requireWorkspaceBinding(chatId)
    return createDirectoryInWorkspace(binding.taskDir, parentRelativePath, name)
  })
}

export async function inspectWorkspaceDirectoryForDeletion(
  chatId: string,
  relativePath: string
) {
  const binding = await requireWorkspaceBinding(chatId)
  return inspectDirectoryInWorkspace(binding.taskDir, relativePath)
}

export async function deleteWorkspaceDirectory(
  chatId: string,
  relativePath: string,
  confirmation: DirectoryDeletionConfirmation
) {
  return withDirectoryWrite(chatId, async () => {
    const binding = await requireWorkspaceBinding(chatId)
    return deleteDirectoryInWorkspace(
      binding.taskDir,
      relativePath,
      confirmation
    )
  })
}

export async function createWorkspaceFile(
  chatId: string,
  parentRelativePath: string,
  name: string
) {
  return withDirectoryWrite(chatId, async () => {
    const binding = await requireWorkspaceBinding(chatId)
    return createFileInWorkspace(binding.taskDir, parentRelativePath, name)
  })
}

export async function uploadWorkspaceFile(
  chatId: string,
  parentRelativePath: string,
  name: string,
  bytes: Uint8Array
) {
  return withDirectoryWrite(chatId, async () => {
    const binding = await requireWorkspaceBinding(chatId)
    return uploadFileToWorkspace(
      binding.taskDir,
      parentRelativePath,
      name,
      bytes
    )
  })
}

/**
 * Store a chat attachment in the task's uploads folder. The folder is created
 * on first use; the file keeps its own name and never overwrites an existing
 * one, so a repeated attachment name gets a distinct copy rather than
 * destroying the earlier upload.
 */
export async function saveChatAttachment(
  chatId: string,
  name: string,
  bytes: Uint8Array
) {
  return withDirectoryWrite(chatId, async () => {
    const binding = await requireWorkspaceBinding(chatId)
    await ensureUploadsDirectory(binding.taskDir)
    return uploadFileToWorkspace(binding.taskDir, UPLOADS_DIR, name, bytes)
  })
}

export async function inspectWorkspaceFileForDeletion(
  chatId: string,
  relativePath: string
) {
  const binding = await requireWorkspaceBinding(chatId)
  return inspectFileInWorkspace(binding.taskDir, relativePath)
}

export async function deleteWorkspaceFile(
  chatId: string,
  relativePath: string,
  confirmation: FileDeletionConfirmation
) {
  return withDirectoryWrite(chatId, async () => {
    const binding = await requireWorkspaceBinding(chatId)
    return deleteFileInWorkspace(binding.taskDir, relativePath, confirmation)
  })
}

export async function listWorkspaceDir(
  chatId: string,
  relPath: string
): Promise<{ entries: FsEntry[]; truncated: boolean }> {
  const binding = await requireWorkspaceBinding(chatId)
  const { absolute: absTarget, relativePath } = await resolveWorkspaceDirectory(
    binding.taskDir,
    relPath
  )

  const names = await fs.readdir(absTarget)
  const entries: FsEntry[] = []
  const truncated = names.length > MAX_ENTRIES

  for (const name of names.slice(0, MAX_ENTRIES)) {
    const childAbs = path.join(absTarget, name)
    // Use lstat so we see the symlink itself, not what it points to.
    let isDir = false
    let isFile = false
    try {
      const st = await fs.lstat(childAbs)
      // Treat symlinks as files (don't follow them).
      isDir = st.isDirectory() && !st.isSymbolicLink()
      isFile = st.isFile() && !st.isSymbolicLink()
    } catch {
      continue
    }

    const childRel = relativePath === "" ? name : `${relativePath}/${name}`

    entries.push({ name, isDir, isFile, relPath: childRel })
  }

  // Directories first, then alphabetical.
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })

  return { entries, truncated }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err
}

function resolveAndNormalise(raw: string): string {
  // path.resolve handles Windows drive letters, UNC, and relative paths.
  return path.resolve(raw)
}

async function assertIsAccessibleDir(absPath: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(absPath)
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      throw new Error(`Directory does not exist: ${absPath}`)
    }
    if (isNodeError(err) && err.code === "EACCES") {
      throw new Error(`Permission denied: ${absPath}`)
    }
    throw new Error(
      `Cannot access directory: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${absPath}`)
  }
  // Verify read access with a readdir.
  try {
    await fs.readdir(absPath)
  } catch {
    throw new Error(`Cannot read directory: ${absPath}`)
  }
}

function assertSafeChatId(chatId: string): void {
  // chatId is a nanoid — alphanumeric + _ - only. No slashes, no dots.
  if (typeof chatId !== "string" || !/^[A-Za-z0-9_\-]{1,64}$/.test(chatId)) {
    throw new Error("Invalid chat ID.")
  }
}
