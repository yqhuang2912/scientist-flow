import "server-only"
import { opendir } from "node:fs/promises"
import { workspaceMentionMediaType } from "./chat-composer"
import { resolveWorkspaceDirectory } from "./workspace-directory.server"
import { isBlockedWorkspaceRegion } from "./workspace-open-policy"

// Read names only. Traverse breadth-first so nearby files surface first.
export async function findWorkspaceMentions(
  taskDir: string,
  query: string,
  signal?: AbortSignal
) {
  const needle = query.toLowerCase()
  const prefix = query.slice(0, Math.max(0, query.lastIndexOf("/")))
  if (prefix && isBlockedWorkspaceRegion(prefix))
    return { paths: [], truncated: false }
  const scoped =
    prefix &&
    (await resolveWorkspaceDirectory(taskDir, prefix).catch(() => null))
  const directories = [scoped ? scoped.relativePath : ""]
  const paths: string[] = []
  let inspected = 0
  let truncated = false
  for (let i = 0; i < directories.length; i++) {
    if (i === 250) return { paths: paths.sort(), truncated: true }
    const parent = directories[i]
    signal?.throwIfAborted()
    try {
      const { absolute } = await resolveWorkspaceDirectory(taskDir, parent)
      for await (const entry of await opendir(absolute)) {
        signal?.throwIfAborted()
        if (++inspected > 6000) return { paths: paths.sort(), truncated: true }
        const relative = parent ? parent + "/" + entry.name : entry.name
        if (entry.isSymbolicLink() || isBlockedWorkspaceRegion(relative))
          continue
        if (entry.isDirectory()) directories.push(relative)
        if (
          entry.isFile() &&
          relative.toLowerCase().includes(needle) &&
          workspaceMentionMediaType(relative)
        ) {
          if (paths.length === 40)
            return { paths: paths.sort(), truncated: true }
          paths.push(relative)
        }
      }
    } catch (error) {
      if (!parent || signal?.aborted) throw error
      truncated = true
    }
  }
  return { paths: paths.sort(), truncated }
}
