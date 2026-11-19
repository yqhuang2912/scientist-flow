import "server-only"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { UIMessage } from "ai"
import type { BotChatContext } from "./chat-bot-context"
import { installationProfileDirectory } from "./chatgpt-vault.server"

// Local worker switch. Its absence (the default) disables the pilot immediately.
export function pilotBotFile() {
  return path.join(installationProfileDirectory(), "deepagents-bot")
}

export async function usesDeepAgent(
  context: BotChatContext,
  botId: string,
  user: UIMessage
) {
  if (
    context.kind !== "direct" ||
    context.bots.length !== 1 ||
    context.bots[0].id !== botId ||
    !user.parts.length ||
    !user.parts.every((part) => part.type === "text")
  )
    return false
  try {
    return (await readFile(pilotBotFile(), "utf8")).trim() === botId
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}
