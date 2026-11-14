import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/**
 * DevPod has no create-only server API. This identifier becomes the workspace
 * name when the sandbox is provisioned later with `devpod up`.
 */
export function createDevPodSandboxId(botId: string) {
  return `bot-${botId}`
}

export async function deleteDevPodSandbox(sandboxId: string) {
  try {
    await execFileAsync("devpod", ["delete", sandboxId, "--force"])
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      stderr?: string
    }

    if (commandError.code === "ENOENT") {
      return
    }

    const output = `${commandError.message ?? ""} ${commandError.stderr ?? ""}`
    if (/not found|does not exist|no workspace/i.test(output)) {
      return
    }

    throw error
  }
}
