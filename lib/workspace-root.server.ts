import "server-only"

import fs from "node:fs/promises"
import { WORKSPACE_ROOT_NOT_EMPTY } from "./workspace-validation"

/** Read at most one entry; hidden files and empty subdirectories also count. */
export async function isWorkspaceRootEmpty(
  directory: string
): Promise<boolean> {
  const handle = await fs.opendir(directory)
  try {
    return (await handle.read()) === null
  } finally {
    await handle.close()
  }
}

export async function assertEmptyWorkspaceRoot(
  directory: string
): Promise<void> {
  if (!(await isWorkspaceRootEmpty(directory))) {
    throw new Error(WORKSPACE_ROOT_NOT_EMPTY)
  }
}
