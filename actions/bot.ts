"use server"

import { nanoid } from "nanoid"

import { db } from "@/lib/db"
import { bots, chatMembers, chats, insertBotSchema } from "@/db/schema"

type CreateBotResult =
  | {
      success: true
      bot: typeof bots.$inferSelect
      chat: typeof chats.$inferSelect
      chatMember: typeof chatMembers.$inferSelect
    }
  | { success: false; error: string }

export async function createBot(input: unknown): Promise<CreateBotResult> {
  const parsed = insertBotSchema.safeParse(input)

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form fields.",
    }
  }

  try {
    const botId = nanoid()
    const chatId = nanoid()
    const [botRows, chatRows, chatMemberRows] = await db.batch([
      db
        .insert(bots)
        .values({ ...parsed.data, id: botId })
        .returning(),
      db
        .insert(chats)
        .values({ id: chatId, kind: "direct", name: null })
        .returning(),
      db.insert(chatMembers).values({ chatId, botId }).returning(),
    ])

    const bot = botRows[0]
    const chat = chatRows[0]
    const chatMember = chatMemberRows[0]

    if (!bot || !chat || !chatMember) {
      return { success: false, error: "The bot could not be created." }
    }

    return { success: true, bot, chat, chatMember }
  } catch (error) {
    console.error("Failed to create bot", error)
    return { success: false, error: "The bot could not be created." }
  }
}
