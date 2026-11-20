import "server-only"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import {
  nativeReplyStream,
  nativeReplyError,
} from "./native-direct-stream.server"
import type { z } from "zod"
import { chats } from "../db/schema"
import { db } from "./db"
import {
  authorMetadata,
  executionInstructions,
  publicModelHistory,
} from "./bot-execution"
import { claimExecution, finishExecution } from "./bot-execution.server"
import { resolveBotModel } from "./bot-model.server"
import { getChatBotMemories } from "../queries/bot-memories"
import { readNativeTranscript } from "../queries/native-chat"
import { deepAgentReply } from "./deepagents-reply.server"
import { ModelConnectionError } from "./model-credentials.server"
import {
  nativeChatMember,
  nativeTurnInput,
  replayNativeTurn,
} from "./native-direct-chat"
import type { BotIdentity } from "./chat-bot-context"

export async function nativeDirectReply(
  chat: {
    id: string
    nativeDirect: boolean
    kind: "direct" | "group"
    bots: BotIdentity[]
  },
  input: z.infer<typeof nativeTurnInput>,
  signal: AbortSignal
) {
  if (nativeChatMember(chat) !== input.botId)
    throw new ModelConnectionError("This bot is unavailable in this chat.")
  const bot = chat.bots[0]
  const runId = nanoid()
  const { claimed, row } = await claimExecution(
    chat.id,
    input.id,
    bot.id,
    runId,
    null,
    input.text
  )
  if (!claimed) return replayNativeTurn(row, input)
  const metadata = { ...authorMetadata(row), engine: "deepagents" as const }
  return nativeReplyStream(
    signal,
    async (active) => {
      const [model, history, memories] = await Promise.all([
        resolveBotModel(chat.id, bot.id, runId, row.id),
        readNativeTranscript(chat.id),
        getChatBotMemories(chat.id, bot.id),
        db
          .update(chats)
          .set({ lastMessageAt: new Date() })
          .where(eq(chats.id, chat.id)),
      ])
      if (!model.explicitEffort)
        throw new ModelConnectionError(
          "Select an explicit reasoning effort for this bot."
        )
      const index = history.findIndex(
        (m) => m.id === input.id && m.role === "user"
      )
      if (index < 0) throw new Error("Missing claimed user message")
      const instructions = executionInstructions({
        bot,
        context: chat,
        memories,
        incoming: null,
        canDelegate: false,
        catalog: "",
        ownTools: [],
      })
      return deepAgentReply({
        route: model(0),
        instructions,
        messages: await publicModelHistory(
          history.slice(0, index + 1),
          chat.bots,
          bot.id
        ),
        signal: active,
        messageId: row.messageId,
        metadata,
        onError: nativeReplyError,
      })
    },
    { id: row.messageId, metadata, role: "assistant", parts: [] },
    (status, message) => finishExecution(row.id, status, message, null)
  )
}
