"use server"

import { hydrateExecutions } from "@/lib/bot-execution.server"
import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"

import { taskFormSchema, bots, chatMembers, chats } from "@/db/schema"
import { db } from "@/lib/db"
import { getChat } from "@/queries/chats"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import {
  chatMemberChoice,
  validateChoice,
} from "@/lib/model-connections.server"
import { ModelConnectionError } from "@/lib/model-credentials.server"

async function assertTriggerChat(chatId: string) {
  const chat = await getChat(chatId)
  if (!chat || chat.nativeDirect) {
    throw new Error("Chat not found")
  }
}

export async function startChatSession(params: {
  chatId: string
  clientData?: unknown
}) {
  if (process.env.SCIENTISTFLOW_INSTALLATION_ID)
    await assertInstallationRequest()
  await assertTriggerChat(params.chatId)
  const { chat } = await import("@trigger.dev/sdk/ai")
  return chat.createStartSessionAction("chat-agent")(params)
}

export async function mintChatAccessToken(chatId: string) {
  if (process.env.SCIENTISTFLOW_INSTALLATION_ID)
    await assertInstallationRequest()
  await assertTriggerChat(chatId)
  const { auth } = await import("@trigger.dev/sdk")
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
  await assertTriggerChat(params.chatId)
  const { chat, defaultStorage } = await import("@trigger.dev/sdk/ai")
  const transcript = await chat.createLoadTranscriptAction(defaultStorage)(params)
  return {
    ...transcript,
    messages: await hydrateExecutions(params.chatId, transcript.messages),
  }
}

export async function prepareChatTurn(chatId: string, botId: string) {
  try {
    if (process.env.SCIENTISTFLOW_INSTALLATION_ID)
      await assertInstallationRequest()
    const choice = await chatMemberChoice(chatId, botId)
    await validateChoice(choice)
    const rows = await db
      .update(chats)
      .set({ lastMessageAt: new Date() })
      .where(eq(chats.id, chatId))
      .returning({ id: chats.id })

    return rows.length ? null : "This chat is unavailable."
  } catch (error) {
    return error instanceof ModelConnectionError
      ? error.message
      : "Could not prepare the conversation. Try again."
  }
}

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
