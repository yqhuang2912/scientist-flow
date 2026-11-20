import "server-only"
import { and, asc, eq } from "drizzle-orm"
import { botMemories, chatMembers } from "../db/schema"
import { db } from "../lib/db"

export async function getChatBotMemories(chatId: string, botId: string) {
  try {
    return await db
      .select({ botId: botMemories.botId, text: botMemories.text })
      .from(chatMembers)
      .innerJoin(botMemories, eq(botMemories.botId, chatMembers.botId))
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.botId, botId)))
      .orderBy(asc(botMemories.createdAt), asc(botMemories.id))
  } catch {
    console.error("Could not read bot memory for chat", chatId)
    throw new Error(
      "Could not load bot preferences. Please retry this message."
    )
  }
}
