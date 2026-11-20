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

export function pilotGroupFile() {
  return path.join(installationProfileDirectory(), "deepagents-group.json")
}

// Resolve both seats once per turn so a switch change between the two calls
// cannot reroute a recipient onto a different engine.
export async function groupPilotRecipient(
  chatId: string,
  context: BotChatContext,
  senderId: string,
  history: UIMessage[],
  user: UIMessage
) {
  if (
    context.kind !== "group" ||
    context.bots.length !== 2 ||
    !user.parts.length ||
    !user.parts.every((p) => p.type === "text") ||
    history.some((m) => {
      if (m.role !== "user") return false
      const refs = (m.metadata as { workspaceFiles?: object } | undefined)
        ?.workspaceFiles
      return (
        (refs && Object.keys(refs).length > 0) ||
        m.parts.some((p) => p.type === "file")
      )
    })
  )
    return
  try {
    const flag = JSON.parse(await readFile(pilotGroupFile(), "utf8"))
    if (
      flag?.chatId === chatId &&
      flag.senderId === senderId &&
      flag.recipientId !== senderId
    )
      return context.bots.find((b) => b.id === flag.recipientId)
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" &&
      !(error instanceof SyntaxError)
    )
      throw error
  }
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
