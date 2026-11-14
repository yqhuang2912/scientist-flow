"use server"

import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"

import { db } from "@/lib/db"
import {
  botFormSchema,
  bots,
  chatMembers,
  chats,
  insertBotSchema,
} from "@/db/schema"
import { createDevPodSandboxId, deleteDevPodSandbox } from "@/lib/devpod"

type CreateBotResult =
  | {
      success: true
      bot: typeof bots.$inferSelect
      chat: typeof chats.$inferSelect
      chatMember: typeof chatMembers.$inferSelect
    }
  | { success: false; error: string }

type UpdateBotResult =
  | { success: true; bot: typeof bots.$inferSelect }
  | { success: false; error: string }

type DeleteBotResult = { success: true } | { success: false; error: string }

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
    const sandboxId = createDevPodSandboxId(botId)
    const [botRows, chatRows, chatMemberRows] = await db.batch([
      db
        .insert(bots)
        .values({ ...parsed.data, id: botId, sandboxId })
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

export async function updateBot(
  botId: string,
  input: unknown
): Promise<UpdateBotResult> {
  if (typeof botId !== "string" || !botId.trim()) {
    return { success: false, error: "The bot could not be updated." }
  }

  const parsed = botFormSchema.safeParse(input)

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form fields.",
    }
  }

  try {
    const rows = await db
      .update(bots)
      .set({
        ...parsed.data,
        instructions: parsed.data.instructions?.trim() || null,
      })
      .where(eq(bots.id, botId))
      .returning()

    const bot = rows[0]
    if (!bot) {
      return { success: false, error: "The bot could not be updated." }
    }

    return { success: true, bot }
  } catch (error) {
    console.error("Failed to update bot", error)
    return { success: false, error: "The bot could not be updated." }
  }
}

export async function deleteBot(botId: string): Promise<DeleteBotResult> {
  if (typeof botId !== "string" || !botId.trim()) {
    return { success: false, error: "The bot could not be deleted." }
  }

  try {
    const botRows = await db
      .select({ sandboxId: bots.sandboxId })
      .from(bots)
      .where(eq(bots.id, botId))
      .limit(1)

    if (!botRows[0]) {
      return { success: false, error: "The bot could not be deleted." }
    }

    if (botRows[0].sandboxId) {
      await deleteDevPodSandbox(botRows[0].sandboxId)
    }

    const directChatRows = await db
      .select({ chatId: chats.id })
      .from(chatMembers)
      .innerJoin(chats, eq(chatMembers.chatId, chats.id))
      .where(and(eq(chatMembers.botId, botId), eq(chats.kind, "direct")))

    const deletedBots = await db
      .delete(bots)
      .where(eq(bots.id, botId))
      .returning({ id: bots.id })

    if (!deletedBots[0]) {
      return { success: false, error: "The bot could not be deleted." }
    }

    const directChatIds = directChatRows.map((row) => row.chatId)
    if (directChatIds.length > 0) {
      await db.delete(chats).where(inArray(chats.id, directChatIds))
    }

    return { success: true }
  } catch (error) {
    console.error("Failed to delete bot", error)
    return { success: false, error: "The bot could not be deleted." }
  }
}
