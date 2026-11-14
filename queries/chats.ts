import "server-only"

import { asc, eq } from "drizzle-orm"

import { bots, chatMembers, chats } from "@/db/schema"
import { db } from "@/lib/db"

export interface ChatWithBot {
  id: string
  kind: "direct" | "group"
  name: string | null
  lastMessagePreview: string | null
  lastMessageAt: Date
  createdAt: Date
  bots: {
    id: string
    name: string
    avatar: string
    job: string
    instructions: string | null
  }[]
  bot: {
    id: string
    name: string
    avatar: string
    job: string
    instructions: string | null
  } | null
}

export async function getChat(chatId: string): Promise<ChatWithBot | null> {
  const rows = await db
    .select({
      id: chats.id,
      kind: chats.kind,
      name: chats.name,
      lastMessagePreview: chats.lastMessagePreview,
      lastMessageAt: chats.lastMessageAt,
      createdAt: chats.createdAt,
      botId: bots.id,
      botName: bots.name,
      botAvatar: bots.avatar,
      botJob: bots.job,
      botInstructions: bots.instructions,
    })
    .from(chats)
    .leftJoin(chatMembers, eq(chatMembers.chatId, chats.id))
    .leftJoin(bots, eq(chatMembers.botId, bots.id))
    .where(eq(chats.id, chatId))
    .orderBy(asc(chatMembers.joinedAt))
  const row = rows[0]
  if (!row) {
    return null
  }

  const memberBots = rows.reduce<ChatWithBot["bots"]>((allBots, currentRow) => {
    if (
      currentRow.botId &&
      currentRow.botName &&
      currentRow.botAvatar &&
      currentRow.botJob &&
      !allBots.some((bot) => bot.id === currentRow.botId)
    ) {
      allBots.push({
        id: currentRow.botId,
        name: currentRow.botName,
        avatar: currentRow.botAvatar,
        job: currentRow.botJob,
        instructions: currentRow.botInstructions,
      })
    }
    return allBots
  }, [])

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    bots: memberBots,
    bot: memberBots[0] ?? null,
  }
}
