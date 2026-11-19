import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import {
  directoryError,
  resolveWorkspaceDirectory,
  WorkspaceDirectoryError,
} from "./workspace-directory.server"
import {
  workspaceFileNameSchema,
  workspaceFileTargetSchema,
  workspaceParentPath,
  deleteWorkspaceFileSchema,
  uploadWorkspaceFileSchema,
  type FileDeletionInspection,
} from "./workspace-validation"

export function fileError(error: unknown) {
  const result = directoryError(error)
  if (error instanceof WorkspaceDirectoryError) return result
  const messages: Record<string, string> = {
    NOT_FOUND: "文件或所在目录已不存在。",
    INACCESSIBLE: "无法访问文件，可能权限不足或正在被占用。",
    IO_ERROR: "文件操作失败，请刷新后重试。",
  }
  return { ...result, error: messages[result.code] ?? result.error }
}

function normaliseAbsolute(value: string) {
  const absolute = path.resolve(value)
  return process.platform === "win32" ? absolute.toLowerCase() : absolute
}

export async function resolveWorkspaceFile(taskDir: string, rawRelative: unknown) {
  const relativePath = workspaceFileTargetSchema.parse(rawRelative)
  const parent = await resolveWorkspaceDirectory(
    taskDir,
    workspaceParentPath(relativePath)
  )
  const name = relativePath.split("/").at(-1)!
  const absolute = path.join(parent.absolute, name)
  const stat = await fs.lstat(absolute, { bigint: true })
  if (stat.isSymbolicLink())
    throw new WorkspaceDirectoryError("LINK", "Symbolic links cannot be opened or modified.")
  if (!stat.isFile())
    throw new WorkspaceDirectoryError(
      "NOT_FILE",
      "The target is not a regular file."
    )
  if (
    normaliseAbsolute(await fs.realpath(absolute)) !==
    normaliseAbsolute(absolute)
  )
    throw new WorkspaceDirectoryError(
      "LINK",
      "文件的实际位置与任务路径不一致，拒绝操作。"
    )
  // Include the parent identity and file version: a replaced parent, replaced
  // file, or edited file requires a fresh confirmation. No content scan needed.
  const identity = createHash("sha256")
    .update(
      [
        parent.identity,
        normaliseAbsolute(absolute),
        stat.dev,
        stat.ino,
        stat.birthtimeNs,
        stat.size,
        stat.mtimeNs,
        stat.ctimeNs,
      ].join(":")
    )
    .digest("hex")
  return { absolute, relativePath, name, identity, stat }
}

export async function createFileInWorkspace(
  taskDir: string,
  rawParent: unknown,
  rawName: unknown
) {
  const name = workspaceFileNameSchema.parse(rawName)
  const parent = await resolveWorkspaceDirectory(taskDir, rawParent)
  // Exclusive creation never overwrites an existing file, folder or link.
  // No recursive parent creation and no extension or filename rewriting.
  const file = await fs.open(path.join(parent.absolute, name), "wx")
  await file.close()
  return {
    name,
    isDir: false as const,
    isFile: true as const,
    relPath: parent.relativePath ? `${parent.relativePath}/${name}` : name,
  }
}

export async function uploadFileToWorkspace(
  taskDir: string,
  rawParent: unknown,
  rawName: unknown,
  rawBytes: unknown
) {
  const input = uploadWorkspaceFileSchema.parse({
    name: rawName,
    bytes: rawBytes,
  })
  // The destination is the folder the upload started from. It must already
  // exist: uploading never creates a directory the user did not ask for.
  const parent = await resolveWorkspaceDirectory(taskDir, rawParent)
  const absolute = path.join(parent.absolute, input.name)
  // Opening exclusively first means a collision fails before any bytes are
  // written, so an existing file is never truncated by a failed upload.
  const file = await fs.open(absolute, "wx")
  try {
    await file.writeFile(input.bytes)
  } catch (error) {
    // Do not leave a partial file behind under the requested name.
    await file.close().catch(() => undefined)
    await fs.unlink(absolute).catch(() => undefined)
    throw error
  }
  await file.close()
  const stat = await fs.stat(absolute)
  return {
    name: input.name,
    isDir: false as const,
    isFile: true as const,
    relPath: parent.relativePath ? `${parent.relativePath}/${input.name}` : input.name,
    size: stat.size,
  }
}

export async function inspectFileInWorkspace(
  taskDir: string,
  rawRelative: unknown
): Promise<FileDeletionInspection> {
  const { relativePath, name, identity } = await resolveWorkspaceFile(
    taskDir,
    rawRelative
  )
  return { relativePath, name, identity }
}

export async function deleteFileInWorkspace(
  taskDir: string,
  rawRelative: unknown,
  rawConfirmation: unknown
) {
  const confirmation = deleteWorkspaceFileSchema.parse(rawConfirmation)
  const target = await resolveWorkspaceFile(taskDir, rawRelative)
  if (target.identity !== confirmation.identity)
    throw new WorkspaceDirectoryError(
      "CHANGED",
      "文件已变化，请核对后重新确认删除。"
    )
  // unlink removes only this directory entry. It never recursively deletes a
  // directory or follows a final symlink. Parent checks are shared with folders.
  await fs.unlink(target.absolute)
}
