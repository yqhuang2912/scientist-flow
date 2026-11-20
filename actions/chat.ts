"use server"

import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"

import { taskFormSchema, bots, chatMembers, chats } from "@/db/schema"
import { db } from "@/lib/db"
type CreateTaskResult =
  | { success: true; chat: typeof chats.$inferSelect }
  | { success: false; error: string }

type UpdateTaskResult =
  | { success: true; chat: typeof chats.$inferSelect }
  | { success: false; error: string }

type DeleteTaskResult = { success: true } | { success: false; error: string }

export async function createTask(input: unknown): Promise<CreateTaskResult> {
  const parsed = taskFormSchema.safeParse(input)

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form fields.",
    }
  }

  const botIds = [...new Set(parsed.data.botIds)]

  try {
    const selectedBots = await db
      .select({ id: bots.id })
      .from(bots)
      .where(inArray(bots.id, botIds))

    if (selectedBots.length !== botIds.length) {
      return { success: false, error: "Select only available bots." }
    }

    const chatId = nanoid()
    const [chatRows] = await db.batch([
      db
        .insert(chats)
        .values({ id: chatId, kind: "group", name: parsed.data.name.trim() })
        .returning(),
      db
        .insert(chatMembers)
        .values(botIds.map((botId) => ({ chatId, botId })))
        .returning(),
    ])

    const createdChat = chatRows[0]
    if (!createdChat) {
      return { success: false, error: "The task could not be created." }
    }

    return { success: true, chat: createdChat }
  } catch (error) {
    console.error("Failed to create task", error)
    return { success: false, error: "The task could not be created." }
  }
}

export async function updateTask(
  chatId: string,
  input: unknown
): Promise<UpdateTaskResult> {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return { success: false, error: "The task could not be updated." }
  }

  const parsed = taskFormSchema.safeParse(input)

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form fields.",
    }
  }

  const botIds = [...new Set(parsed.data.botIds)]

  try {
    const existingChat = await db
      .select({ kind: chats.kind })
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1)

    if (existingChat[0]?.kind !== "group") {
      return { success: false, error: "The task could not be updated." }
    }

    const selectedBots = await db
      .select({ id: bots.id })
      .from(bots)
      .where(inArray(bots.id, botIds))

    if (selectedBots.length !== botIds.length) {
      return { success: false, error: "Select only available bots." }
    }

    const [chatRows] = await db.batch([
      db
        .update(chats)
        .set({ name: parsed.data.name.trim() })
        .where(eq(chats.id, chatId))
        .returning(),
      db.delete(chatMembers).where(eq(chatMembers.chatId, chatId)),
      db
        .insert(chatMembers)
        .values(botIds.map((botId) => ({ chatId, botId })))
        .returning(),
    ])

    const updatedChat = chatRows[0]
    if (!updatedChat) {
      return { success: false, error: "The task could not be updated." }
    }

    return { success: true, chat: updatedChat }
  } catch (error) {
    console.error("Failed to update task", error)
    return { success: false, error: "The task could not be updated." }
  }
}

export async function deleteTask(chatId: string): Promise<DeleteTaskResult> {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return { success: false, error: "The task could not be deleted." }
  }

  try {
    const deletedChats = await db
      .delete(chats)
      .where(and(eq(chats.id, chatId), eq(chats.kind, "group")))
      .returning({ id: chats.id })

    if (!deletedChats[0]) {
      return { success: false, error: "The task could not be deleted." }
    }

    return { success: true }
  } catch (error) {
    console.error("Failed to delete task", error)
    return { success: false, error: "The task could not be deleted." }
  }
}
