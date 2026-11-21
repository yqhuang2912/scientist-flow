import "server-only"
import { and, eq, inArray, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { UIMessage } from "ai"
import { botExecutions as executions, chatTurns } from "../db/schema"
import { db } from "./db"
import {
  mergeExecutionMessages,
  type ExecutionStatus,
  type Delegation,
} from "./bot-execution"

function leaseGuard(lease: string | undefined, chatId: string, turnId: string) {
  return lease
    ? sql`exists (select 1 from ${chatTurns} where chat_id=${chatId} and id=${turnId}
    and lease=${lease} and state='running' and lease_until>now())`
    : undefined
}

export async function claimExecution(
  chatId: string,
  userMessageId: string,
  botId: string,
  runId: string,
  delegation: Delegation | null,
  lease?: string,
  slot = delegation ? 1 : 0
) {
  const executionId = nanoid()
  // Test the lease in the insert itself. A worker resuming after a pause
  // cannot create a new speaker slot once another worker owns the turn.
  await db.execute(sql`
    insert into ${executions}
      (id, message_id, chat_id, user_message_id, bot_id, run_id, slot, parent_execution_id, status, delegation)
    select ${executionId}, ${nanoid()}, ${chatId}, ${userMessageId}, ${botId}, ${runId},
           ${slot}, ${delegation?.parentExecutionId ?? null}, 'running', ${delegation ? JSON.stringify(delegation) : null}::jsonb
    where ${leaseGuard(lease, chatId, userMessageId) ?? sql`true`}
    on conflict do nothing
  `)
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
  if (!existing || existing.botId !== botId)
    throw new Error("Execution claim unavailable.")
  if (existing.id === executionId) return { row: existing, claimed: true }
  if (lease && existing.status === "running" && existing.runId !== runId) {
    const [resumed] = await db
      .update(executions)
      .set({ runId })
      .where(
        and(
          eq(executions.id, existing.id),
          eq(executions.status, "running"),
          eq(executions.runId, existing.runId),
          leaseGuard(lease, chatId, userMessageId)
        )
      )
      .returning()
    if (!resumed)
      throw new Error("Could not reclaim the interrupted execution.")
    return { row: resumed, claimed: true, resumed: true }
  }
  return { row: existing, claimed: false }
}
export async function finishExecution(
  id: string,
  status: Exclude<ExecutionStatus, "running">,
  message: UIMessage | null,
  delegation: Delegation | null,
  lease?: string
) {
  const result = await db
    .update(executions)
    .set({ status, message, delegation })
    .where(
      and(
        eq(executions.id, id),
        eq(executions.status, "running"),
        lease
          ? sql`exists (select 1 from ${chatTurns} where lease=${lease} and ${executions.runId}=${lease} and state='running' and lease_until>now())`
          : undefined
      )
    )
  return result.rowCount > 0
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
    .orderBy(executions.slot)
  return mergeExecutionMessages(
    history,
    rows.flatMap((r) => (r.message ? [r.message] : []))
  )
}
