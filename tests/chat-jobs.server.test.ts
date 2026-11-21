import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { test } from "node:test"
import { nanoid } from "nanoid"
import { and, eq, sql } from "drizzle-orm"
import { chatJobInput } from "../lib/chat-job"
import { chatAttachmentParts } from "../lib/chat-composer"

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
  "a completed submission replays its persisted attachments without re-reading the workspace or updating recency",
  { skip: process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1" },
  async () => {
    const { db } = await import("../lib/db")
    const { chats, chatTurns } = await import("../db/schema")
    const { enqueueChatTurn, TurnConflict } =
      await import("../lib/chat-jobs.server")
    const previousOwner = process.env.SCIENTISTFLOW_INSTALLATION_ID
    const owner = randomUUID(),
      chatId = nanoid()
    const accepted = new Date("2026-01-01T10:00:00.000Z")
    const later = new Date("2026-01-02T10:00:00.000Z")
    const upload = {
      relativePath: "uploads/a.txt",
      name: "a.txt",
      mediaType: "text/plain",
      size: 1,
    }
    const input = chatJobInput.parse({
      id: nanoid(),
      botId: nanoid(),
      text: "",
      files: [upload],
      workspacePaths: ["docs/b.txt"],
    })
    const { parts, workspaceFiles } = chatAttachmentParts(
      [
        upload,
        {
          ...upload,
          origin: "workspace" as const,
          relativePath: "docs/b.txt",
          name: "b.txt",
        },
      ].map((reference) => ({
        reference,
        part: {
          type: "file",
          mediaType: "text/plain",
          filename: reference.name,
          url: "data:text/plain;base64,YQ==",
        },
      })),
      input.text
    )
    const userMessage = {
      id: input.id,
      role: "user" as const,
      metadata: { botId: input.botId, workspaceFiles },
      parts,
    }
    process.env.SCIENTISTFLOW_INSTALLATION_ID = owner
    try {
      await db.batch([
        db.insert(chats).values({ id: chatId, lastMessageAt: later }),
        db
          .insert(chatTurns)
          .values({
            chatId,
            id: input.id,
            owner,
            userMessage,
            state: "completed",
            createdAt: accepted,
            inputHash: createHash("sha256")
              .update(JSON.stringify(input))
              .digest("hex"),
          }),
      ])
      assert.deepEqual(await enqueueChatTurn(chatId, input), {
        turnId: input.id,
        userMessage,
        state: "completed",
        acceptedAt: accepted.toISOString(),
      })
      await assert.rejects(
        enqueueChatTurn(chatId, { ...input, text: "Different input" }),
        TurnConflict
      )
      const [chat] = await db.select().from(chats).where(eq(chats.id, chatId))
      assert.equal(chat.lastMessageAt.toISOString(), later.toISOString())
    } finally {
      if (previousOwner === undefined)
        delete process.env.SCIENTISTFLOW_INSTALLATION_ID
      else process.env.SCIENTISTFLOW_INSTALLATION_ID = previousOwner
      await db.delete(chats).where(eq(chats.id, chatId))
    }
  }
)

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
