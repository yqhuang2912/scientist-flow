import assert from "node:assert/strict"
import { test } from "node:test"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { UIMessage, UIMessageChunk } from "ai"
import {
  nativeChatMember,
  nativeTranscript,
  nativeTurnInput,
  replayNativeTurn,
} from "../lib/native-direct-chat"
import { nativeReplyStream } from "../lib/native-direct-stream.server"

const input = { id: "user-turn", botId: nanoid(), text: "Hello" }
const reply: UIMessage = {
  id: "reply",
  role: "assistant",
  parts: [{ type: "text", text: "Hi!" }],
  metadata: { botId: input.botId, executionId: "execution" },
}
const row = {
  userMessageId: input.id,
  botId: input.botId,
  userText: input.text,
  status: "completed" as const,
  message: reply,
}

async function chunks(stream: ReadableStream<UIMessageChunk>) {
  const list: UIMessageChunk[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return list
    list.push(value)
  }
}

test("only the marked direct chat with exactly one member accepts native text turns", () => {
  const chat = {
    nativeDirect: true,
    kind: "direct",
    bots: [{ id: input.botId }],
  }
  assert.equal(nativeChatMember(chat), input.botId)
  for (const invalid of [
    null,
    { ...chat, nativeDirect: false },
    { ...chat, kind: "group" },
    { ...chat, bots: [] },
    { ...chat, bots: [...chat.bots, ...chat.bots] },
  ])
    assert.equal(nativeChatMember(invalid), null)
  assert.ok(nativeTurnInput.safeParse(input).success)
  for (const invalid of [
    { ...input, text: " " },
    { ...input, role: "assistant" },
    { ...input, files: [] },
    { ...input, id: "" },
  ])
    assert.ok(!nativeTurnInput.safeParse(invalid).success)
})

test("history and completed replays use the stored authors, IDs and text", async () => {
  const user = {
    id: input.id,
    role: "user",
    metadata: { botId: input.botId },
    parts: [{ type: "text", text: input.text }],
  }
  assert.deepEqual(nativeTranscript([row]), [user, reply])
  assert.deepEqual(nativeTranscript([{ ...row, userText: null }]), [])
  const replay = await chunks(replayNativeTurn(row, input))
  assert.deepEqual(replay[0], {
    type: "start",
    messageId: reply.id,
    messageMetadata: reply.metadata,
  })
  assert.deepEqual(replay[2], {
    type: "text-delta",
    id: reply.id,
    delta: "Hi!",
  })
  assert.throws(() => replayNativeTurn(row, { ...input, text: "changed" }))
  for (const status of ["failed", "cancelled", "running"] as const) {
    assert.deepEqual(nativeTranscript([{ ...row, status }]), [user])
    assert.throws(() => replayNativeTurn({ ...row, status }, input))
  }
})

test("cancelled, interrupted and errored streams never persist a partial assistant reply", async () => {
  for (const ending of ["cancel", "error", "truncated", "complete"]) {
    const ac = new AbortController()
    const writes: { status: string; message: UIMessage | null }[] = []
    const stream = nativeReplyStream(
      ac.signal,
      async () =>
        new ReadableStream({
          start(c) {
            c.enqueue({ type: "text-delta", id: reply.id, delta: "partial" })
            if (ending === "cancel") ac.abort()
            if (ending === "error")
              c.enqueue({ type: "error", errorText: "Provider interrupted." })
            if (ending === "complete") c.enqueue({ type: "finish" })
            c.close()
          },
        }),
      reply,
      async (status, message) => {
        writes.push({ status, message })
      }
    )
    const output = await chunks(stream)
    assert.equal(writes.length, 1)
    if (ending === "complete") {
      assert.equal(writes[0].status, "completed")
      assert.equal(output.at(-1)?.type, "finish")
    } else {
      assert.deepEqual(writes, [
        { status: ending === "cancel" ? "cancelled" : "failed", message: null },
      ])
      assert.equal(output.at(-1)?.type, ending === "cancel" ? "abort" : "error")
    }
  }
})

test(
  "concurrent native sends share one database claim, completed history and replay",
  {
    skip: process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1",
  },
  async () => {
    const { chats } = await import("../db/schema")
    const { db } = await import("../lib/db")
    const { claimExecution, finishExecution } =
      await import("../lib/bot-execution.server")
    const { readNativeTranscript } = await import("../queries/native-chat")
    const chatId = nanoid()
    await db
      .insert(chats)
      .values({ id: chatId, kind: "direct", nativeOwner: nanoid() })
    try {
      const claim = () =>
        claimExecution(
          chatId,
          input.id,
          input.botId,
          nanoid(),
          null,
          input.text
        )
      const contenders = await Promise.all([claim(), claim()])
      assert.equal(contenders.filter((c) => c.claimed).length, 1)
      const winner = contenders[0].row
      assert.equal(winner.id, contenders[1].row.id)
      assert.equal((await readNativeTranscript(chatId)).length, 1)
      const stored = {
        ...reply,
        id: winner.messageId,
        metadata: { ...(reply.metadata as object), executionId: winner.id },
      }
      await finishExecution(winner.id, "completed", stored, null)
      const retried = await claim()
      assert.equal(retried.claimed, false)
      assert.equal(retried.row.messageId, winner.messageId)
      const history = await readNativeTranscript(chatId)
      assert.deepEqual(
        history.map((m) => m.id),
        [input.id, winner.messageId]
      )
      assert.deepEqual(history[1], stored)
      assert.equal(
        (await chunks(replayNativeTurn(retried.row, input))).at(-1)?.type,
        "finish"
      )
    } finally {
      await db.delete(chats).where(eq(chats.id, chatId))
    }
  }
)
