import "server-only"
import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import { readUIMessageStream, type UIMessage } from "ai"
import { botExecutions, chatTurns } from "../db/schema"
import { db } from "./db"
import { runBotTurn } from "./chat-turn.server"
import { createChatWorker } from "./chat-worker-scheduler"
import {
  chatSnapshot,
  heartbeat,
  leaseChatTurn,
  saveProgress,
  settleTurn,
  currentLease,
  ChatLeaseLost,
} from "./chat-jobs.server"
import { installationOwner } from "./model-credentials.server"

type Job = typeof chatTurns.$inferSelect
async function execute(job: Job, lease: string) {
  const controller = new AbortController()
  let checking = false
  const beat = setInterval(async () => {
    if (checking) return
    checking = true
    try {
      const row = await heartbeat(lease)
      if (!row) controller.abort(new ChatLeaseLost())
      else if (row.cancel) controller.abort()
    } catch {
      controller.abort(new ChatLeaseLost())
    } finally {
      checking = false
    }
  }, 5000)
  let replies: UIMessage[] = []
  try {
    if (job.cancelRequested) {
      await db
        .update(botExecutions)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(botExecutions.chatId, job.chatId),
            eq(botExecutions.userMessageId, job.id),
            eq(botExecutions.status, "running"),
            sql`exists (select 1 from ${chatTurns} where ${currentLease(lease)})`
          )
        )
      await settleTurn(lease, job.replies, null)
      return
    }
    const history = (await chatSnapshot(job.chatId)).messages
    const index = history.findIndex((m) => m.role === "user" && m.id === job.id)
    if (index < 0) throw new Error("Missing queued message")
    // A recovered turn rebuilds only unfinished speakers. Completed messages
    // are restored from bot_executions, including a handoff awaiting its recipient.
    replies = history.slice(index + 1).filter((m) => m.role === "assistant")
    await runBotTurn({
      chatId: job.chatId,
      requestedBotId: (job.userMessage.metadata as { botId: string }).botId,
      runId: lease,
      lease,
      signal: controller.signal,
      transcript: history.slice(0, index + 1),
      publish: async (stream) => {
        let latest: UIMessage | undefined
        let lastWrite = 0
        for await (const message of readUIMessageStream({ stream })) {
          latest = message
          const pos = replies.findIndex((m) => m.id === message.id)
          if (pos < 0) replies.push(message)
          else replies[pos] = message
          if (Date.now() - lastWrite >= 750) {
            try {
              await saveProgress(lease, replies)
            } catch (error) {
              controller.abort(new ChatLeaseLost())
              throw error
            }
            lastWrite = Date.now()
          }
        }
        return latest
      },
      saveReplies: (messages) => {
        replies = messages
      },
    })
    if (controller.signal.reason instanceof ChatLeaseLost) return
    const failed = await db
      .select({ id: botExecutions.id })
      .from(botExecutions)
      .where(
        and(
          eq(botExecutions.chatId, job.chatId),
          eq(botExecutions.userMessageId, job.id),
          eq(botExecutions.status, "failed")
        )
      )
      .limit(1)
    await settleTurn(
      lease,
      replies,
      failed.length ? "A bot could not complete this turn." : null
    )
  } catch {
    if (!(controller.signal.reason instanceof ChatLeaseLost))
      await settleTurn(lease, replies, "Could not complete this chat turn.")
  } finally {
    clearInterval(beat)
  }
}

const globalWorker = globalThis as typeof globalThis & {
  scientistFlowWakeChatWorker?: () => void
}
export function wakeChatWorker() {
  if (!process.env.SCIENTISTFLOW_INSTALLATION_ID) return
  const wake = (globalWorker.scientistFlowWakeChatWorker ??= createChatWorker({
    claim: leaseChatTurn,
    execute,
    hasPending: async (activeChats) => {
      const [pending] = await db
        .select({ id: chatTurns.id })
        .from(chatTurns)
        .where(
          and(
            eq(chatTurns.owner, installationOwner()),
            notInArray(chatTurns.chatId, activeChats),
            inArray(chatTurns.state, ["running", "queued"])
          )
        )
        .limit(1)
      return !!pending
    },
  }))
  wake()
}
