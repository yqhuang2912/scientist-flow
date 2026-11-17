import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import {
  workspaceRelativePathSchema,
  workspaceDirectoryTargetSchema,
  workspaceDirectoryNameSchema,
  deleteWorkspaceDirectorySchema,
  type DirectoryDeletionInspection,
} from "./workspace-validation"

export class WorkspaceDirectoryError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = "WorkspaceDirectoryError"
  }
}

function fail(code: string, message: string): never {
  throw new WorkspaceDirectoryError(code, message)
}

export function directoryError(error: unknown): {
  code: string
  error: string
} {
  if (error instanceof WorkspaceDirectoryError)
    return { code: error.code, error: error.message }
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === "ENOENT") return { code: "NOT_FOUND", error: "文件夹已不存在。" }
  if (code === "EEXIST")
    return {
      code: "CONFLICT",
      error: "同名文件或文件夹已存在，请使用其他名称。",
    }
  if (code === "EACCES" || code === "EPERM" || code === "EBUSY")
    return {
      code: "INACCESSIBLE",
      error: "无法访问文件夹，可能权限不足或正在被占用。",
    }
  if (code === "ENAMETOOLONG")
    return { code: "INVALID", error: "名称或完整路径过长，请缩短名称。" }
  if (error && typeof error === "object" && "issues" in error)
    return {
      code: "INVALID",
      error: "参数无效，请检查名称、相对路径和删除确认信息。",
    }
  return { code: "IO_ERROR", error: "文件夹操作失败，请刷新后重试。" }
}

function normaliseAbsolute(value: string) {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function assertInside(root: string, target: string) {
  const relative = path.relative(
    normaliseAbsolute(root),
    normaliseAbsolute(target)
  )
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    fail("UNSAFE_PATH", "路径超出当前任务目录。")
  }
}

async function realDirectory(absolute: string) {
  const stat = await fs.lstat(absolute, { bigint: true })
  if (stat.isSymbolicLink())
    fail("LINK", "不能通过符号链接或 junction 操作文件夹。")
  if (!stat.isDirectory())
    fail("NOT_DIRECTORY", "目标不是实际文件夹，不能执行文件夹操作。")
  const real = await fs.realpath(absolute)
  if (normaliseAbsolute(real) !== normaliseAbsolute(absolute)) {
    fail("LINK", "目录的实际位置与绑定路径不一致，拒绝操作。")
  }
  return stat
}

/** Validate the saved binding, its ancestors, and EVERY relative component. */
export async function resolveWorkspaceDirectory(
  taskDir: string,
  rawRelative: unknown
) {
  const relativePath = workspaceRelativePathSchema.parse(rawRelative)
  if (!path.isAbsolute(taskDir)) fail("UNSAFE_PATH", "任务绑定目录无效。")
  const root = path.resolve(taskDir)
  const volume = path.parse(root).root
  let current = volume
  await realDirectory(current)
  for (const component of path
    .relative(volume, root)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, component)
    await realDirectory(current)
  }
  const rootReal = await fs.realpath(root)
  for (const component of relativePath.split("/").filter(Boolean)) {
    current = path.join(current, component)
    assertInside(rootReal, current)
    await realDirectory(current)
  }
  const stat = await realDirectory(current)
  assertInside(rootReal, await fs.realpath(current))
  const identity = createHash("sha256")
    .update(
      [
        normaliseAbsolute(rootReal),
        normaliseAbsolute(current),
        stat.dev,
        stat.ino,
        stat.birthtimeNs,
      ].join(":")
    )
    .digest("hex")
  return { absolute: current, relativePath, identity }
}

async function directoryIsEmpty(absolute: string) {
  const handle = await fs.opendir(absolute)
  try {
    return (await handle.read()) === null
  } finally {
    await handle.close()
  }
}

export async function createDirectoryInWorkspace(
  taskDir: string,
  rawParent: unknown,
  rawName: unknown
) {
  const name = workspaceDirectoryNameSchema.parse(rawName)
  const parent = await resolveWorkspaceDirectory(taskDir, rawParent)
  const relativePath = parent.relativePath
    ? `${parent.relativePath}/${name}`
    : name
  // mkdir without recursive is atomic on collisions and never fills in missing parents.
  await fs.mkdir(path.join(parent.absolute, name))
  return { name, isDir: true as const, relPath: relativePath }
}

export async function inspectDirectoryInWorkspace(
  taskDir: string,
  rawRelative: unknown
): Promise<DirectoryDeletionInspection> {
  const relative = workspaceDirectoryTargetSchema.parse(rawRelative)
  const target = await resolveWorkspaceDirectory(taskDir, relative)
  const isEmpty = await directoryIsEmpty(target.absolute)
  return {
    relativePath: relative,
    name: relative.split("/").at(-1)!,
    isEmpty,
    identity: target.identity,
  }
}

/**
 * Node 22 rimraf normally unlinks symlinks, but its Windows EPERM fallback uses
 * stat/chmod. Use lstat + unlink for links, with no following/chmod fallback.
 * Revalidate ancestors before each step; never use shell removal or fs.rm's
 * recursive fallback. This is not transactional or an OS-level filesystem lock.
 */
async function removeDirectoryContents(
  taskDir: string,
  relative: string,
  identity: string
) {
  let target = await resolveWorkspaceDirectory(taskDir, relative)
  if (target.identity !== identity) fail("CHANGED", "目录已变化，请重新确认。")
  const handle = await fs.opendir(target.absolute)
  try {
    for await (const child of handle) {
      target = await resolveWorkspaceDirectory(taskDir, relative)
      if (target.identity !== identity)
        fail("CHANGED", "目录已变化，请重新确认。")
      const absolute = path.join(target.absolute, child.name)
      assertInside(taskDir, absolute)
      let stat
      try {
        stat = await fs.lstat(absolute)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
        throw error
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        // unlink removes the link itself (including Windows junctions).
        await fs.unlink(absolute).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error
        })
      } else {
        const childRelative = `${relative}/${child.name}`
        const checked = await resolveWorkspaceDirectory(taskDir, childRelative)
        await removeDirectoryContents(taskDir, childRelative, checked.identity)
      }
    }
  } finally {
    // for-await closes Dir automatically, including when the loop throws.
    await handle.close().catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ERR_DIR_CLOSED") throw error
    })
  }
  target = await resolveWorkspaceDirectory(taskDir, relative)
  if (target.identity !== identity) fail("CHANGED", "目录已变化，请重新确认。")
  await fs.rmdir(target.absolute)
}

export async function deleteDirectoryInWorkspace(
  taskDir: string,
  rawRelative: unknown,
  rawConfirmation: unknown
) {
  const relative = workspaceDirectoryTargetSchema.parse(rawRelative)
  const confirmation = deleteWorkspaceDirectorySchema.parse(rawConfirmation)
  const inspected = await inspectDirectoryInWorkspace(taskDir, relative)
  if (inspected.identity !== confirmation.identity)
    fail("CHANGED", "目录已变化，请重新确认。")
  if (
    confirmation.mode === "recursive" &&
    confirmation.name !== inspected.name
  ) {
    fail("CONFIRMATION", "请输入完全一致的文件夹名称以确认删除全部内容。")
  }
  if (confirmation.mode === "empty" && !inspected.isEmpty)
    fail("CHANGED", "目录内容已变化，请重新确认。")
  const target = await resolveWorkspaceDirectory(taskDir, relative)
  if (target.identity !== inspected.identity)
    fail("CHANGED", "目录已变化，请重新确认。")
  try {
    if (confirmation.mode === "empty") await fs.rmdir(target.absolute)
    else await removeDirectoryContents(taskDir, relative, target.identity)
  } catch (error) {
    // A disappearing descendant is not evidence that the requested folder is gone.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await resolveWorkspaceDirectory(taskDir, relative)
      fail("CHANGED", "目录内容已变化，请重新确认。")
    }
    if (
      ["ENOTEMPTY", "EEXIST"].includes(
        (error as NodeJS.ErrnoException).code ?? ""
      )
    ) {
      fail("CHANGED", "目录内容已变化，请重新确认。")
    }
    throw error
  }
}
