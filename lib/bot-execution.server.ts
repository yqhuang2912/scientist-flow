import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { UIMessage } from "ai"
import { botExecutions as executions } from "../db/schema"
import { db } from "./db"
import {
  mergeExecutionMessages,
  type ExecutionStatus,
  type Delegation,
} from "./bot-execution"

export async function claimExecution(
  chatId: string,
  userMessageId: string,
  botId: string,
  runId: string,
  delegation: Delegation | null,
  userText?: string
) {
  const slot = delegation ? 1 : 0
  const values = {
    id: nanoid(),
    messageId: nanoid(),
    chatId,
    userMessageId,
    userText,
    botId,
    runId,
    slot,
    parentExecutionId: delegation?.parentExecutionId ?? null,
    status: "running" as const,
    delegation,
  }
  const [claimed] = await db
    .insert(executions)
    .values(values)
    .onConflictDoNothing()
    .returning()
  if (claimed) return { row: claimed, claimed: true }
  const [existing] = await db
    .select()
    .from(executions)
    .where(
      and(
        eq(executions.chatId, chatId),
        eq(executions.userMessageId, userMessageId),
        eq(executions.slot, slot)
      )
    )
  if (!existing) throw new Error("Execution claim unavailable.")
  return { row: existing, claimed: false }
}
export async function finishExecution(
  id: string,
  status: Exclude<ExecutionStatus, "running">,
  message: UIMessage | null,
  delegation: Delegation | null
) {
  await db
    .update(executions)
    .set({ status, message, delegation })
    .where(and(eq(executions.id, id), eq(executions.status, "running")))
}
export async function hydrateExecutions(chatId: string, history: UIMessage[]) {
  const ids = history.filter((m) => m.role === "user").map((m) => m.id)
  if (!ids.length) return history
  const rows = await db
    .select({ message: executions.message })
    .from(executions)
    .where(
      and(eq(executions.chatId, chatId), inArray(executions.userMessageId, ids))
    )
  return mergeExecutionMessages(
    history,
    rows.flatMap((r) => (r.message ? [r.message] : []))
  )
}
