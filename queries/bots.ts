import "server-only"

import { formatDistanceToNow } from "date-fns"
import { asc, desc, eq } from "drizzle-orm"

import { bots, chatMembers, chats } from "@/db/schema"
import { db } from "@/lib/db"

export interface SidebarChat {
  id: string
  name: string
  lastMessagePreview: string
  lastMessageAtLabel: string
  bot: {
    id: string
    name: string
    avatar: string
  } | null
}

export async function getUserChats(): Promise<SidebarChat[]> {
  const [firstBotRows, chatRows] = await Promise.all([
    db
      .select({
        id: bots.id,
        name: bots.name,
        avatar: bots.avatar,
      })
      .from(bots)
      .orderBy(asc(bots.createdAt))
      .limit(1),
    db
      .select({
        chatId: chats.id,
        chatKind: chats.kind,
        chatName: chats.name,
        lastMessagePreview: chats.lastMessagePreview,
        lastMessageAt: chats.lastMessageAt,
        botId: bots.id,
        botName: bots.name,
        botAvatar: bots.avatar,
      })
      .from(chats)
      .leftJoin(chatMembers, eq(chatMembers.chatId, chats.id))
      .leftJoin(bots, eq(chatMembers.botId, bots.id))
      .orderBy(desc(chats.lastMessageAt), desc(chatMembers.joinedAt)),
  ])

  const firstBot = firstBotRows[0] ?? null
  const chatMap = new Map<string, SidebarChat>()

  for (const row of chatRows) {
    if (chatMap.has(row.chatId)) {
      continue
    }

    const memberBot =
      row.botId && row.botName && row.botAvatar
        ? {
            id: row.botId,
            name: row.botName,
            avatar: row.botAvatar,
          }
        : null
    const bot =
      row.chatKind === "group"
        ? (firstBot ?? memberBot)
        : (memberBot ?? firstBot)

    chatMap.set(row.chatId, {
      id: row.chatId,
      name: row.chatName ?? bot?.name ?? "Untitled chat",
      lastMessagePreview: row.lastMessagePreview ?? "",
      lastMessageAtLabel: formatDistanceToNow(row.lastMessageAt, {
        addSuffix: false,
      }),
      bot,
    })
  }

  return [...chatMap.values()]
}
