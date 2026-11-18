"use server"

import { defaultStorage } from "@trigger.dev/sdk/ai"
import { and, asc, eq, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"
import {
  botMemories,
  botMemoryFormSchema,
  botMemoryLimit,
  bots,
} from "@/db/schema"
import { db } from "@/lib/db"
import { getChat } from "@/queries/chats"

const unavailable = {
  success: false as const,
  error: "Open this bot’s direct chat to manage its memory.",
}

async function directBotId(chatId: string) {
  if (!z.nanoid().safeParse(chatId).success) return null
  const chat = await getChat(chatId)
  return chat?.kind === "direct" && chat.bots.length === 1
    ? chat.bots[0].id
    : null
}

function failed(operation: string) {
  // Database errors can include the query parameters. Never log preference text.
  console.error("Bot memory operation failed:", operation)
  return {
    success: false as const,
    error: "Could not " + operation + " bot memory. Please try again.",
  }
}

export async function listBotMemories(chatId: string) {
  try {
    const botId = await directBotId(chatId)
    if (!botId) return unavailable
    const rows = await db
      .select({ id: botMemories.id, text: botMemories.text })
      .from(botMemories)
      .where(eq(botMemories.botId, botId))
      .orderBy(asc(botMemories.createdAt), asc(botMemories.id))
    return { success: true as const, data: rows }
  } catch {
    return failed("load")
  }
}

export async function saveBotMemory(
  chatId: string,
  sourceId: string,
  input: unknown
) {
  const parsed = botMemoryFormSchema.safeParse(input)
  if (!parsed.success)
    return { success: false as const, error: parsed.error.issues[0].message }
  if (!z.string().min(1).max(256).safeParse(sourceId).success)
    return {
      success: false as const,
      error: "Select a user message in this direct chat.",
    }
  try {
    const botId = await directBotId(chatId)
    if (!botId) return unavailable
    const transcript = await defaultStorage.load({
      chatId,
      clientData: undefined,
    })
    if (
      !transcript.messages.some(
        (m) =>
          m.id === sourceId &&
          m.role === "user" &&
          m.parts.some((p) => p.type === "text" && p.text.trim())
      )
    ) {
      return {
        success: false as const,
        error:
          "The source user message is unavailable. If you just sent it, try again shortly.",
      }
    }
    const text = parsed.data.text
    const id = nanoid()
    // A Neon HTTP batch is one transaction. Take the per-bot lock in its own
    // statement, so the following count sees the last writer's committed rows.
    const [, , rows] = await db.batch([
      db
        .select({ id: bots.id })
        .from(bots)
        .where(eq(bots.id, botId))
        .for("no key update"),
      db.execute(sql`insert into ${botMemories} (id, bot_id, text, source_chat_id, source_message_id)
        select ${id}, ${botId}, ${text}, ${chatId}, ${sourceId}
        where (select count(*) from ${botMemories} where bot_id = ${botId}) < ${botMemoryLimit}
        on conflict (bot_id, text) do nothing`),
      db
        .select({ id: botMemories.id })
        .from(botMemories)
        .where(and(eq(botMemories.botId, botId), eq(botMemories.text, text))),
    ])
    if (!rows.length)
      return {
        success: false as const,
        error:
          "Memory is full. Remove a preference in Bot memory before saving another.",
      }
    return { success: true as const, duplicate: rows[0].id !== id }
  } catch {
    return failed("save")
  }
}

export async function removeBotMemory(chatId: string, memoryId: string) {
  try {
    const botId = await directBotId(chatId)
    if (!botId) return unavailable
    if (!z.nanoid().safeParse(memoryId).success)
      return { success: false as const, error: "Invalid memory." }
    const rows = await db
      .delete(botMemories)
      .where(and(eq(botMemories.botId, botId), eq(botMemories.id, memoryId)))
      .returning({ id: botMemories.id })
    return { success: true as const, removed: rows.length > 0 }
  } catch {
    return failed("remove")
  }
}
