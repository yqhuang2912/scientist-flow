import "server-only"
import { and, asc, eq, isNotNull } from "drizzle-orm"
import { botExecutions } from "../db/schema"
import { db } from "../lib/db"
import { nativeTranscript } from "../lib/native-direct-chat"

export async function readNativeTranscript(chatId: string) {
  const rows = await db
    .select({
      userMessageId: botExecutions.userMessageId,
      userText: botExecutions.userText,
      botId: botExecutions.botId,
      status: botExecutions.status,
      message: botExecutions.message,
    })
    .from(botExecutions)
    .where(
      and(eq(botExecutions.chatId, chatId), isNotNull(botExecutions.userText))
    )
    .orderBy(asc(botExecutions.createdAt), asc(botExecutions.id))
  return nativeTranscript(rows)
}
