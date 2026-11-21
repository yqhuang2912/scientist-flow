import "server-only"
import { posix } from "node:path"
import {
  createDirectoryInWorkspace,
  resolveWorkspaceDirectory,
} from "./workspace-directory.server"
import { workspaceDirectoryTargetSchema } from "./workspace-validation"

export const WORKSPACE_LAYOUT_VERSION = 2
export const REPORTS_DIR = "outputs/docs"
export const LOGS_DIR = "logs"

/** Create one component at a time, checking existing entries just like the file tree. */
export async function ensureWorkspaceDirectory(
  taskDir: string,
  relativePath: string
) {
  const relative = workspaceDirectoryTargetSchema.parse(relativePath)
  let parent = ""
  for (const name of relative.split("/")) {
    const child = posix.join(parent, name)
    try {
      await createDirectoryInWorkspace(taskDir, parent, name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      await resolveWorkspaceDirectory(taskDir, child)
    }
    parent = child
  }
}

export async function ensureWorkspaceLayout(taskDir: string, existing = false) {
  const added = ["configs", LOGS_DIR, REPORTS_DIR]
  const directories = existing
    ? added
    : [
        "src",
        "data",
        "docs",
        "outputs/figures",
        "outputs/checkpoints",
        ...added,
      ]
  for (const directory of directories)
    await ensureWorkspaceDirectory(taskDir, directory)
}
