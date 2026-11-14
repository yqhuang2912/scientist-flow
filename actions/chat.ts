"use server"

import { auth } from "@trigger.dev/sdk"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import { inArray } from "drizzle-orm"
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

type CreateGroupChatResult =
  | { success: true; chat: typeof chats.$inferSelect }
  | { success: false; error: string }

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
