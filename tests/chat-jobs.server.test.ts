import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { nanoid } from "nanoid"
import { and, eq, sql } from "drizzle-orm"
import { chatJobInput } from "../lib/chat-job"

test("turn input accepts a user message or workspace attachment and rejects client history", () => {
  const input = { id: nanoid(), botId: nanoid(), text: "hello" }
  assert.ok(chatJobInput.safeParse(input).success)
  assert.ok(!chatJobInput.safeParse({ ...input, role: "assistant" }).success)
  assert.ok(!chatJobInput.safeParse({ ...input, text: " " }).success)
  assert.ok(
    !chatJobInput.safeParse({
      ...input,
      files: [{ url: "https://example.org/doc.pdf" }],
    }).success
  )
  assert.ok(
    chatJobInput.safeParse({
      ...input,
      text: "",
      files: [
        {
          relativePath: "uploads/a.txt",
          name: "a.txt",
          size: 4,
          mediaType: "text/plain",
        },
      ],
    }).success
  )
})

test(
  "expired leases are reclaimed; stale writers cannot overwrite progress or finalize a resumed turn",
  {
    skip: process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1",
  },
  async () => {
    const { db } = await import("../lib/db")
    const { chats, chatTurns, botExecutions } = await import("../db/schema")
    const {
      leaseChatTurn,
      saveProgress,
      settleTurn,
      cancelChatTurn,
      chatSnapshot,
    } = await import("../lib/chat-jobs.server")
    const { claimExecution, finishExecution } =
      await import("../lib/bot-execution.server")
    const oldOwner = process.env.SCIENTISTFLOW_INSTALLATION_ID
    const owner = randomUUID(),
      chatId = nanoid(),
      id = nanoid(),
      botId = nanoid()
    process.env.SCIENTISTFLOW_INSTALLATION_ID = owner
    const user = {
      id,
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Resume me" }],
      metadata: { botId },
    }
    try {
      await db.insert(chats).values({ id: chatId })
      await db
        .insert(chatTurns)
        .values({ owner, chatId, id, inputHash: "fixture", userMessage: user })
      const claims = await Promise.all([
        leaseChatTurn(nanoid()),
        leaseChatTurn(nanoid()),
      ])
      const active = claims.filter(Boolean)
      assert.equal(active.length, 1)
      const oldLease = active[0].lease!
      const { row } = await claimExecution(
        chatId,
        id,
        botId,
        oldLease,
        null,
        oldLease
      )
      await db
        .update(chatTurns)
        .set({ leaseUntil: sql`now()-interval '1 second'` })
        .where(and(eq(chatTurns.chatId, chatId), eq(chatTurns.id, id)))
      const fresh = nanoid()
      assert.equal(await leaseChatTurn(nanoid(), [chatId]), undefined)
      const job = await leaseChatTurn(fresh)
      assert.equal(job.id, id)
      await assert.rejects(saveProgress(oldLease, []))
      const resumed = await claimExecution(
        chatId,
        id,
        botId,
        fresh,
        null,
        fresh
      )
      assert.equal(resumed.row.messageId, row.messageId)
      assert.equal(resumed.claimed, true)
      await finishExecution(row.id, "failed", null, null, oldLease)
      assert.equal(
        (
          await db
            .select()
            .from(botExecutions)
            .where(eq(botExecutions.id, row.id))
        )[0].status,
        "running"
      )
      await settleTurn(oldLease, [], "stale")
      assert.equal((await chatSnapshot(chatId)).activeId, id)
      await cancelChatTurn(chatId, id)
      await finishExecution(row.id, "cancelled", null, null, fresh)
      await settleTurn(fresh, [], null)
      const after = await chatSnapshot(chatId)
      assert.equal(after.activeId, null)
      assert.deepEqual(after.messages, [user])
    } finally {
      await db.delete(chats).where(eq(chats.id, chatId))
      if (oldOwner === undefined)
        delete process.env.SCIENTISTFLOW_INSTALLATION_ID
      else process.env.SCIENTISTFLOW_INSTALLATION_ID = oldOwner
    }
  }
)
