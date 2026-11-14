"use server"

import { auth } from "@trigger.dev/sdk"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"

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
