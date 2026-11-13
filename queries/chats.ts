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
    .limit(1)

  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    bot:
      row.botId && row.botName && row.botAvatar && row.botJob
        ? {
            id: row.botId,
            name: row.botName,
            avatar: row.botAvatar,
            job: row.botJob,
            instructions: row.botInstructions,
          }
        : null,
  }
}
