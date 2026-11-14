"use server"

import { auth } from "@trigger.dev/sdk"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"

import { groupChatFormSchema, bots, chatMembers, chats } from "@/db/schema"
import { db } from "@/lib/db"
import { getChat } from "@/queries/chats"

const createChatSession = chat.createStartSessionAction("chat-agent")
const readChatTranscript = chat.createLoadTranscriptAction(defaultStorage)

async function assertChatExists(chatId: string) {
  if (!(await getChat(chatId))) {
    throw new Error("Chat not found")
  }
}

export async function startChatSession(params: {
  chatId: string
  clientData?: unknown
}) {
  await assertChatExists(params.chatId)
  return createChatSession(params)
}

export async function mintChatAccessToken(chatId: string) {
  await assertChatExists(chatId)

  return auth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  })
}

export async function loadChatTranscript(params: {
  chatId: string
  limit?: number
}) {
  await assertChatExists(params.chatId)
  return readChatTranscript(params)
}

export async function touchChatActivity(chatId: string): Promise<boolean> {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return false
  }

  try {
    const rows = await db
      .update(chats)
      .set({ lastMessageAt: new Date() })
      .where(eq(chats.id, chatId))
      .returning({ id: chats.id })

    return Boolean(rows[0])
  } catch (error) {
    console.error("Failed to update chat activity", error)
    return false
  }
}

type CreateGroupChatResult =
  | { success: true; chat: typeof chats.$inferSelect }
  | { success: false; error: string }

type UpdateGroupChatResult =
  | { success: true; chat: typeof chats.$inferSelect }
  | { success: false; error: string }

type DeleteGroupChatResult =
  { success: true } | { success: false; error: string }

export async function createGroupChat(
  input: unknown
): Promise<CreateGroupChatResult> {
  const parsed = groupChatFormSchema.safeParse(input)

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
      return { success: false, error: "The group chat could not be created." }
    }

    return { success: true, chat: createdChat }
  } catch (error) {
    console.error("Failed to create group chat", error)
    return { success: false, error: "The group chat could not be created." }
  }
}

export async function updateGroupChat(
  chatId: string,
  input: unknown
): Promise<UpdateGroupChatResult> {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return { success: false, error: "The group chat could not be updated." }
  }

  const parsed = groupChatFormSchema.safeParse(input)

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
      return { success: false, error: "The group chat could not be updated." }
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
      return { success: false, error: "The group chat could not be updated." }
    }

    return { success: true, chat: updatedChat }
  } catch (error) {
    console.error("Failed to update group chat", error)
    return { success: false, error: "The group chat could not be updated." }
  }
}

export async function deleteGroupChat(
  chatId: string
): Promise<DeleteGroupChatResult> {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return { success: false, error: "The group chat could not be deleted." }
  }

  try {
    const deletedChats = await db
      .delete(chats)
      .where(and(eq(chats.id, chatId), eq(chats.kind, "group")))
      .returning({ id: chats.id })

    if (!deletedChats[0]) {
      return { success: false, error: "The group chat could not be deleted." }
    }

    return { success: true }
  } catch (error) {
    console.error("Failed to delete group chat", error)
    return { success: false, error: "The group chat could not be deleted." }
  }
}
