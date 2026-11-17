import "server-only"

import { formatDistanceToNow } from "date-fns"
import { asc, desc, eq } from "drizzle-orm"

import { bots, chatMembers, chats } from "@/db/schema"
import { db } from "@/lib/db"

export type BotSummary = Pick<
  typeof bots.$inferSelect,
  "id" | "name" | "avatar" | "job" | "instructions"
>

export interface SidebarChat {
  id: string
  kind: "direct" | "group"
  name: string
  lastMessagePreview: string
  lastMessageAtLabel: string
  bots: Pick<BotSummary, "id" | "name" | "avatar" | "job">[]
  bot: Pick<BotSummary, "id" | "name" | "avatar" | "job"> | null
}

export async function getUserChats(): Promise<SidebarChat[]> {
  const chatRows = await db
    .select({
      chatId: chats.id,
      chatKind: chats.kind,
      chatName: chats.name,
      lastMessagePreview: chats.lastMessagePreview,
      lastMessageAt: chats.lastMessageAt,
      botId: bots.id,
      botName: bots.name,
      botAvatar: bots.avatar,
      botJob: bots.job,
    })
    .from(chats)
    .leftJoin(chatMembers, eq(chatMembers.chatId, chats.id))
    .leftJoin(bots, eq(chatMembers.botId, bots.id))
    .orderBy(desc(chats.lastMessageAt), desc(chatMembers.joinedAt))

  const chatMap = new Map<string, SidebarChat>()

  for (const row of chatRows) {
    const memberBot =
      row.botId && row.botName && row.botAvatar
        ? {
            id: row.botId,
            name: row.botName,
            avatar: row.botAvatar,
            job: row.botJob ?? "",
          }
        : null

    const existingChat = chatMap.get(row.chatId)
    if (existingChat) {
      if (
        memberBot &&
        !existingChat.bots.some((bot) => bot.id === memberBot.id)
      ) {
        existingChat.bots.push(memberBot)
      }
      continue
    }

    const memberBots = memberBot ? [memberBot] : []
    chatMap.set(row.chatId, {
      id: row.chatId,
      kind: row.chatKind,
      name: row.chatName ?? memberBot?.name ?? "Untitled chat",
      lastMessagePreview: row.lastMessagePreview ?? "",
      lastMessageAtLabel: formatDistanceToNow(row.lastMessageAt, {
        addSuffix: false,
      }),
      bots: memberBots,
      bot: memberBot,
    })
  }

  return [...chatMap.values()]
}

export async function getBots(): Promise<BotSummary[]> {
  return db.select().from(bots).orderBy(asc(bots.createdAt))
}
