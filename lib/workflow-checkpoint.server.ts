import "server-only"
import { and, eq, inArray, sql } from "drizzle-orm"
import { chatTurns as turns } from "../db/schema"
import { db } from "./db"
import { currentLease, TurnConflict, ChatLeaseLost } from "./chat-jobs.server"
import { installationOwner } from "./model-credentials.server"
import {
  initialCheckpoint,
  type CheckpointCommand,
  type WorkflowCheckpoint,
} from "./workflow-checkpoint"

const checkpoint = sql<WorkflowCheckpoint>`${turns.userMessage} #> '{metadata,checkpoint}'`
const phase = sql`${checkpoint}->>'phase'`
const revision = sql`((${checkpoint}->>'revision')::int + 1)`
function replaceCheckpoint(next: ReturnType<typeof sql>) {
  return sql`jsonb_set(${turns.userMessage}, '{metadata,checkpoint}', ${next})`
}

export async function changeCheckpoint(
  chatId: string,
  id: string,
  command: CheckpointCommand
) {
  const key = and(
    eq(turns.owner, installationOwner()),
    eq(turns.chatId, chatId),
    eq(turns.id, id)
  )
  const pause = command.action === "pause"
  const patch = JSON.stringify(
    command.action === "submit"
      ? initialCheckpoint(command)
      : { phase: pause ? "armed" : "released" }
  )
  const anchor =
    command.action === "submit"
      ? sql`jsonb_build_object('afterMessageId', ${turns.replies}->-1->>'id')`
      : sql`'{}'::jsonb`
  const [updated] = await db
    .update(turns)
    .set({
      state: sql`case when ${phase}='waiting' then 'queued' else ${turns.state} end`,
      lease: sql`case when ${phase}='waiting' then null else ${turns.lease} end`,
      leaseUntil: sql`case when ${phase}='waiting' then null else ${turns.leaseUntil} end`,
      userMessage: replaceCheckpoint(
        sql`${checkpoint} || ${patch}::jsonb || ${anchor} || jsonb_build_object('revision', ${revision})`
      ),
    })
    .where(
      and(
        key,
        inArray(turns.state, ["queued", "running"]),
        eq(turns.cancelRequested, false),
        pause
          ? sql`${phase} = 'open'`
          : sql`${phase} in ('open','armed','waiting')`
      )
    )
    .returning({ checkpoint })
  if (updated) return updated.checkpoint
  const [existing] = await db.select({ checkpoint }).from(turns).where(key)
  const saved = existing?.checkpoint
  if (
    saved &&
    (pause
      ? ["armed", "waiting"].includes(saved.phase)
      : ["released", "passed"].includes(saved.phase) &&
        saved.note ===
          (command.action === "submit" ? command.note : undefined) &&
        (command.action !== "submit" ||
          JSON.stringify(saved.mentionedBotIds ?? []) ===
            JSON.stringify(command.mentionedBotIds ?? [])))
  )
    return saved
  throw new TurnConflict(
    "This checkpoint has already changed or the run has ended. Refresh to see its status."
  )
}

// The worker and the UI update the same turn row. The first committed update
// decides whether to park here or to close the checkpoint and begin review.
export async function reachCheckpoint(lease: string) {
  const waiting = sql`${phase} = 'armed'`
  const [row] = await db
    .update(turns)
    .set({
      userMessage:
        replaceCheckpoint(sql`${checkpoint} || jsonb_build_object('phase',
      case when ${waiting} then 'waiting' else 'passed' end, 'revision', ${revision})`),
      // Keep the active-chat constraint while releasing the worker lease.
      // A null deadline is never eligible for lease recovery.
      lease: sql`case when ${waiting} then null else ${turns.lease} end`,
      leaseUntil: sql`case when ${waiting} then null else ${turns.leaseUntil} end`,
    })
    .where(
      and(
        currentLease(lease),
        eq(turns.cancelRequested, false),
        sql`${phase} in ('open','armed','released')`
      )
    )
    .returning({ checkpoint })
  if (row) return row.checkpoint
  const [existing] = await db
    .select({ checkpoint, cancelled: turns.cancelRequested })
    .from(turns)
    .where(currentLease(lease))
  if (!existing) throw new ChatLeaseLost()
  if (existing.cancelled) throw new Error("Run cancelled.")
  return existing.checkpoint // previously crossed, or a run created before checkpoints
}
