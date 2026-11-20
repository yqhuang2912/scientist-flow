import "server-only"

import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
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
  MAX_UPLOAD_BYTES,
  UPLOAD_SIZE_ERROR,
  type UploadedEntry,
  renameWorkspaceEntrySchema,
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
  rawParent: string,
  input: { name: string; size: number },
  body: ReadableStream<Uint8Array>,
  attachment = false
): Promise<UploadedEntry> {
  const { name, size } = uploadWorkspaceFileSchema.parse(input)
  const parent = await resolveWorkspaceDirectory(taskDir, rawParent)
  if (!attachment) {
    const existing = await fs
      .lstat(path.join(parent.absolute, name))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error
        return null
      })
    if (existing)
      throw new WorkspaceDirectoryError(
        "CONFLICT",
        "A file or folder with this name already exists."
      )
  }
  const staging = path.join(parent.absolute, `.sf-upload-${randomUUID()}.tmp`)
  const temp = await fs.open(staging, "wx", 0o600)
  try {
    const reader = body.getReader()
    let received = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > MAX_UPLOAD_BYTES)
          throw new WorkspaceDirectoryError("TOO_LARGE", UPLOAD_SIZE_ERROR)
        if (received > size)
          throw new WorkspaceDirectoryError(
            "INVALID",
            "Upload exceeded the declared file size."
          )
        await temp.writeFile(value)
      }
      if (received !== size)
        throw new WorkspaceDirectoryError(
          "INVALID",
          "Upload was incomplete. Please retry."
        )
    } finally {
      if (received !== size) await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    const current = await resolveWorkspaceDirectory(taskDir, rawParent)
    if (current.identity !== parent.identity)
      throw new WorkspaceDirectoryError(
        "CHANGED",
        "The destination folder changed during upload."
      )
    // An exclusive hard link publishes the completed file without overwriting
    // another writer. Filesystems without hard links use exclusive copy.
    const ext = path.extname(name)
    const stem = path.basename(name, ext)
    for (let copy = 0; ; copy++) {
      const suffix = copy ? ` (${copy})` : ""
      const finalName =
        stem.slice(0, 255 - suffix.length - ext.length) + suffix + ext
      const target = path.join(parent.absolute, finalName)
      try {
        try {
          await fs.link(staging, target)
        } catch (error) {
          if (
            !["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM"].includes(
              (error as NodeJS.ErrnoException).code ?? ""
            )
          )
            throw error
          await fs.copyFile(staging, target, constants.COPYFILE_EXCL)
        }
      } catch (error) {
        if (!attachment || (error as NodeJS.ErrnoException).code !== "EEXIST")
          throw error
        continue
      }
      return {
        name: finalName,
        relPath: [parent.relativePath, finalName].filter(Boolean).join("/"),
        size,
        isDir: false,
        isFile: true,
      }
    }
  } finally {
    await temp.close()
    // Never clean up through a parent that has been replaced by a link.
    const current = await resolveWorkspaceDirectory(taskDir, rawParent)
    if (current.identity === parent.identity) await fs.unlink(staging)
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

/**
 * Read the identity a rename must confirm against. A file uses the file
 * resolver; a directory uses the directory resolver, because its identity is
 * the directory's own rather than a child's.
 */
export async function inspectEntryForRename(
  taskDir: string,
  rawRelative: unknown
) {
  const relativePath = workspaceFileTargetSchema.parse(rawRelative)
  const parent = await resolveWorkspaceDirectory(
    taskDir,
    workspaceParentPath(relativePath)
  )
  const name = relativePath.split("/").at(-1)!
  const stat = await fs.lstat(path.join(parent.absolute, name), {
    bigint: true,
  })
  if (stat.isSymbolicLink())
    throw new WorkspaceDirectoryError(
      "LINK",
      "Symbolic links cannot be renamed."
    )
  if (stat.isDirectory()) {
    const target = await resolveWorkspaceDirectory(taskDir, relativePath)
    return {
      relativePath,
      name,
      isDir: true as const,
      identity: target.identity,
    }
  }
  const target = await resolveWorkspaceFile(taskDir, relativePath)
  return {
    relativePath,
    name,
    isDir: false as const,
    identity: target.identity,
  }
}

/**
 * Rename one entry in place. Only the final segment changes: the parent is the
 * same resolved directory for both the old and the new name, so a rename can
 * never move an entry out of the task or across folders.
 */
export async function renameWorkspaceEntry(
  taskDir: string,
  rawRelative: unknown,
  rawConfirmation: unknown
) {
  const confirmation = renameWorkspaceEntrySchema.parse(rawConfirmation)
  const relativePath = workspaceFileTargetSchema.parse(rawRelative)
  if (relativePath.split("/").at(-1) === confirmation.name)
    return { name: confirmation.name, relativePath }

  const parentRelative = workspaceParentPath(relativePath)
  const parent = await resolveWorkspaceDirectory(taskDir, parentRelative)
  const current = relativePath.split("/").at(-1)!
  const source = path.join(parent.absolute, current)
  const destination = path.join(parent.absolute, confirmation.name)

  // Reuse the file resolver when the entry is a file, so the same identity
  // check and symlink refusal applies. A directory is resolved separately,
  // because its identity is the directory's own, not a child's.
  const stat = await fs.lstat(source, { bigint: true })
  if (stat.isSymbolicLink())
    throw new WorkspaceDirectoryError(
      "LINK",
      "Symbolic links cannot be renamed."
    )
  const fileIdentity = stat.isFile()
    ? (await resolveWorkspaceFile(taskDir, relativePath)).identity
    : null
  const directoryIdentity = stat.isDirectory()
    ? (await resolveWorkspaceDirectory(taskDir, relativePath)).identity
    : null
  if (
    fileIdentity !== confirmation.identity &&
    directoryIdentity !== confirmation.identity
  )
    throw new WorkspaceDirectoryError(
      "CHANGED",
      "文件或文件夹已变化，请核对后重新操作。"
    )

  // rename replaces the destination on POSIX, so check first: a rename must
  // never silently destroy a different entry that already holds the new name.
  try {
    await fs.lstat(destination, { bigint: true })
    throw new WorkspaceDirectoryError(
      "CONFLICT",
      "同名文件或文件夹已存在，请使用其他名称。"
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  await fs.rename(source, destination)
  return {
    name: confirmation.name,
    relativePath: parentRelative
      ? `${parentRelative}/${confirmation.name}`
      : confirmation.name,
  }
}

/** Bounded reads, verified file descriptor and path identity before AND after IO. */
export async function readWorkspaceFileBytes(
  taskDir: string,
  relative: string,
  limit: number,
  sizeError: string,
  prefixBytes?: number
) {
  const target = await resolveWorkspaceFile(taskDir, relative)
  if (target.stat.size > BigInt(limit))
    throw new WorkspaceDirectoryError("TOO_LARGE", sizeError)
  const handle = await fs.open(
    target.absolute,
    constants.O_RDONLY |
      (process.platform === "win32" ? 0 : constants.O_NOFOLLOW)
  )
  try {
    const before = await handle.stat({ bigint: true })
    if (
      !before.isFile() ||
      before.ino !== target.stat.ino ||
      before.dev !== target.stat.dev ||
      before.size !== target.stat.size
    )
      throw new WorkspaceDirectoryError(
        "CONFLICT",
        "The file changed while it was being read. Please reload."
      )
    const bytes = Buffer.alloc(Math.min(Number(target.stat.size) + 1, prefixBytes ?? Infinity))
    let length = 0
    while (length < bytes.length) {
      const chunk = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length
      )
      if (!chunk.bytesRead) break
      length += chunk.bytesRead
    }
    if (length > limit)
      throw new WorkspaceDirectoryError("TOO_LARGE", sizeError)
    const after = await resolveWorkspaceFile(taskDir, relative)
    const end = await handle.stat({ bigint: true })
    if (
      target.identity !== after.identity ||
      before.mtimeNs !== end.mtimeNs ||
      before.ctimeNs !== end.ctimeNs ||
      before.size !== end.size
    )
      throw new WorkspaceDirectoryError(
        "CONFLICT",
        "The file changed while it was being read. Please reload."
      )
    return { target, raw: bytes.subarray(0, length) }
  } finally {
    await handle.close()
  }
}
