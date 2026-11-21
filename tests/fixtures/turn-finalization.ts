import assert from "node:assert/strict"
import type { TestContext } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import type { UIMessage } from "ai"
import { and, eq, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import {
  botExecutions,
  chatMembers,
  chats,
  chatTurns,
  modelRequests,
} from "../../db/schema"
import { db } from "../../lib/db"
import {
  hydrateExecutions,
  finishExecution,
} from "../../lib/bot-execution.server"
import {
  chatSnapshot,
  ChatLeaseLost,
  leaseChatTurn,
  saveProgress,
  settleTurn,
  turnProgress,
} from "../../lib/chat-jobs.server"
import { wakeChatWorker } from "../../lib/chat-worker.server"
import { installationOwner } from "../../lib/model-credentials.server"
import { getHandoff, getToolPresentation } from "../../lib/chat-presentation"
import { toolCallAnchor } from "../../lib/project-decisions"
import { readProjectDecisions } from "../../lib/project-decisions.server"

async function queue(chatId: string, input: UIMessage) {
  await db.insert(chatTurns).values({
    chatId,
    id: input.id,
    userMessage: input,
    owner: installationOwner(),
    inputHash: "fixture",
  })
  const lease = nanoid()
  assert.equal((await leaseChatTurn(lease))?.id, input.id)
  return lease
}

export async function checkTurnFinalization(
  t: TestContext,
  count: number,
  a: string,
  b: string,
  input: UIMessage,
  run: (
    chatId: string,
    prior: UIMessage[],
    lease: string
  ) => Promise<UIMessage[]>
) {
  const chatId = nanoid()
  const turns = Array.from({ length: count }, (_, i) => {
    const id = nanoid(),
      messageId = nanoid(),
      executionId = nanoid()
    const user: UIMessage = {
      id,
      role: "user",
      parts: [{ type: "text", text: "Historical question" }],
    }
    const reply: UIMessage = {
      id: messageId,
      role: "assistant",
      metadata: {
        botId: a,
        userMessageId: id,
        executionId,
        parentExecutionId: null,
      },
      parts: [{ type: "text", text: "Historical answer" }],
    }
    return {
      turn: {
        id,
        chatId,
        userMessage: user,
        replies: [reply],
        createdAt: new Date(1_700_000_000_000 + i),
        state: "completed" as const,
        owner: installationOwner(),
        inputHash: "fixture",
      },
      execution: {
        id: executionId,
        messageId,
        chatId,
        userMessageId: id,
        botId: a,
        slot: 0,
        status: "completed" as const,
        message: reply,
        runId: "fixture",
      },
    }
  })
  const samples: { ids: string[]; rows: number; bytes: number }[] = []
  // Measure the driver's actual decoded response for the message projection.
  const fetch = globalThis.fetch
  t.mock.method(
    globalThis,
    "fetch",
    async (...args: Parameters<typeof fetch>) => {
      const response = await fetch(...args)
      const body = args[1]?.body
      if (typeof body !== "string" || !body.includes("bot_executions"))
        return response
      const { query, params } = JSON.parse(body)
      if (
        query?.startsWith('select "message" from "bot_executions"') &&
        params[0] === chatId
      ) {
        const bytes = Buffer.from(await response.clone().arrayBuffer())
        samples.push({
          ids: params.slice(1),
          rows: JSON.parse(bytes.toString()).rows.length,
          bytes: bytes.length,
        })
      }
      return response
    }
  )
  try {
    await db.batch([
      db.insert(chats).values({ id: chatId, kind: "group" }),
      db.insert(chatMembers).values([a, b].map((botId) => ({ chatId, botId }))),
      db.insert(chatTurns).values(turns.map((r) => r.turn)),
      db.insert(botExecutions).values(turns.map((r) => r.execution)),
    ])
    const lease = await queue(chatId, input)
    const transcript = (await chatSnapshot(chatId)).messages
    const delivered = await run(chatId, transcript.slice(0, -1), lease)
    const [, sender, recipient] = delivered
    assert.equal(delivered.length, 3, JSON.stringify(sender?.parts))
    assert.ok(sender.parts.some((p) => getHandoff(p)?.targetId === b))
    assert.equal(samples.length, 2)
    const [startup, final] = samples
    assert.equal(startup.ids.length, count + 1)
    assert.deepEqual(final.ids, [input.id])
    assert.equal(final.rows, 2)
    // Re-run the old final query against exactly the same committed executions.
    await hydrateExecutions(chatId, [...transcript, sender, recipient])
    const baseline = samples[2]
    assert.deepEqual(baseline.ids, startup.ids)
    assert.equal(baseline.rows, count + 2)
    t.diagnostic(
      `history=${count} before=${baseline.ids.length} IDs/${baseline.rows} rows/${baseline.bytes} B after=1 ID/${final.rows} rows/${final.bytes} B`
    )

    await settleTurn(lease, [sender, recipient], null)
    const refreshed = await chatSnapshot(chatId)
    assert.deepEqual(refreshed.messages.slice(count * 2), delivered)
    const [decision] = await readProjectDecisions(chatId)
    assert.ok(decision?.toolEvidence)
    const saved = refreshed.messages.at(-1)!
    const source = saved.parts.find(
      (p) =>
        "toolCallId" in p && p.toolCallId === decision.toolEvidence!.toolCallId
    )
    assert.ok(source && "output" in source)
    const receipt = saved.parts.find(
      (p) => p.type === "tool-record_project_decision"
    )
    assert.ok(receipt && "toolCallId" in receipt)
    assert.deepEqual(
      getToolPresentation(receipt, false).memory?.evidence,
      decision.toolEvidence
    )
    assert.equal(
      toolCallAnchor(saved.id, source.toolCallId),
      toolCallAnchor(decision.sourceMessageId, decision.toolEvidence.toolCallId)
    )
  } finally {
    await db.batch([
      db.delete(modelRequests).where(eq(modelRequests.chatId, chatId)),
      db.delete(chats).where(eq(chats.id, chatId)),
    ])
  }
}

export async function checkResumedHandoff(
  t: TestContext,
  chatId: string,
  a: string,
  b: string,
  input: UIMessage,
  run: (lease: string, controller: AbortController) => Promise<UIMessage[]>
) {
  const lease = await queue(chatId, input)
  const controller = new AbortController()
  const waiting = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>()
  const fetch = globalThis.fetch
  let recipientRequests = 0
  let senderSkillReads = 0
  t.mock.method(
    globalThis,
    "fetch",
    async (...args: Parameters<typeof fetch>) => {
      const body = args[1]?.body
      if (typeof body === "string" && body.includes("instructions")) {
        const { query, params } = JSON.parse(body)
        if (
          query?.startsWith(
            'select "instructions", "updated_at" from "skills"'
          ) &&
          params.includes(chatId) &&
          params.includes(a)
        )
          senderSkillReads++
      }
      if (
        String(args[0]) === "https://openrouter.ai/api/v1/chat/completions" &&
        new Headers(args[1]?.headers).get("authorization") ===
          "Bearer fixture-rowan" &&
        ++recipientRequests === 1
      ) {
        waiting.resolve()
        await release.promise
      }
      return fetch(...args)
    }
  )
  const first = run(lease, controller)
  try {
    await Promise.race([
      waiting.promise,
      first.then(() => {
        throw Error("Recipient never started")
      }),
    ])
    const executions = () =>
      db
        .select()
        .from(botExecutions)
        .where(
          and(
            eq(botExecutions.chatId, chatId),
            eq(botExecutions.userMessageId, input.id)
          )
        )
        .orderBy(botExecutions.slot)
    const [sender, recipient] = await executions()
    assert.equal(sender.status, "completed")
    assert.ok(
      sender.message?.parts.some(
        (p) => p.type === "tool-read_skill" && p.state === "output-available"
      )
    )
    assert.equal(recipient.status, "running")
    assert.equal(senderSkillReads, 1)
    assert.deepEqual((await turnProgress(chatId, input.id)).replies, [])
    await db
      .update(chatTurns)
      .set({ leaseUntil: sql`now() - interval '1 second'` })
      .where(eq(chatTurns.lease, lease))
    controller.abort(new ChatLeaseLost())
    wakeChatWorker()
    const timeout = AbortSignal.timeout(45_000)
    let progress
    do {
      await delay(100, undefined, { signal: timeout })
      progress = await turnProgress(chatId, input.id)
    } while (progress.state === "running" || progress.state === "queued")
    assert.equal(progress.state, "completed", progress.error ?? undefined)
    assert.deepEqual(
      progress.replies.map((r) => r.id),
      [sender.messageId, recipient.messageId]
    )
    assert.deepEqual(progress.replies[0], sender.message)
    assert.ok(
      progress.replies[1].parts.some(
        (p) => p.type === "text" && p.text === "63，Rowan"
      )
    )
    const completed = (await executions())[1]
    assert.equal(completed.status, "completed")
    assert.equal(completed.botId, b)
    assert.equal(sender.botId, a)
    assert.notEqual(completed.runId, lease)
    assert.equal(completed.parentExecutionId, sender.id)
    release.resolve()
    await first
    await assert.rejects(saveProgress(lease, []), ChatLeaseLost)
    await finishExecution(recipient.id, "failed", null, null, lease)
    await settleTurn(lease, [], "stale")
    assert.deepEqual((await executions())[1], completed)
    assert.deepEqual(await turnProgress(chatId, input.id), progress)
    assert.deepEqual(
      (await chatSnapshot(chatId)).messages.slice(-2),
      progress.replies
    )
    assert.equal(recipientRequests, 2)
    assert.equal(senderSkillReads, 1)
  } finally {
    release.resolve()
    await first
  }
}
