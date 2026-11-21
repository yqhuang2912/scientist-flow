import assert from "node:assert/strict"
import { test } from "node:test"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import {
  checkpointTranscript,
  initialCheckpoint,
} from "../lib/workflow-checkpoint"

test("a checkpoint instruction is a user message, anchored once at submission; plain runs add no message", () => {
  const note = "Recompute case 6"
  const run = {
    id: "workflow_test",
    role: "user" as const,
    parts: [],
    metadata: { checkpoint: initialCheckpoint() },
  }
  const experiment = {
    id: "experiment",
    role: "assistant" as const,
    parts: [],
    metadata: { workflowStep: 1 },
  }
  const supplement = {
    id: "extra",
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text: "**人工介入 · 补充实验**\n\n" + note + "\n\nResult",
      },
    ],
    metadata: { workflowStep: 1, intervention: note },
  }
  const history = [run, experiment, supplement]
  assert.equal(checkpointTranscript(history), history)
  const submitted = {
    ...run,
    metadata: {
      checkpoint: {
        ...initialCheckpoint({ action: "submit", note }),
        afterMessageId: experiment.id,
      },
    },
  }
  const recipient = nanoid(),
    reviewer = nanoid()
  const mentions = [recipient, reviewer]
  const text = "@Mira recheck before @Iris reviews."
  const explicit = {
    ...run,
    metadata: {
      botId: recipient,
      checkpoint: initialCheckpoint({
        action: "submit",
        note: text,
        mentionedBotIds: mentions,
      }),
    },
  }
  const bubble = checkpointTranscript([explicit, experiment])[1]
  assert.deepEqual(bubble.metadata, {
    botId: recipient,
    checkpointNote: true,
    mentionedBotIds: mentions,
  })
  assert.deepEqual(bubble.parts, [{ type: "text", text }])
  const raw = [submitted, experiment, supplement]
  const visible = checkpointTranscript(raw)
  assert.deepEqual(
    visible.map((m) => m.id),
    [run.id, experiment.id, run.id + "_checkpoint_note", supplement.id]
  )
  assert.deepEqual(visible[2], {
    id: run.id + "_checkpoint_note",
    role: "user",
    parts: [{ type: "text", text: note }],
  })
  assert.deepEqual(visible[3].parts, [
    { type: "text", text: "**人工介入 · 补充实验**\n\nResult" },
  ])
  assert.deepEqual(checkpointTranscript(raw), visible)
  assert.equal(
    checkpointTranscript([
      {
        ...run,
        metadata: { checkpoint: initialCheckpoint({ action: "submit", note }) },
      },
      experiment,
    ])[1].role,
    "user"
  )
})

test(
  "a parked checkpoint keeps its chat reservation, releases the worker, and consumes one instruction",
  {
    skip:
      !process.env.DATABASE_URL ||
      process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1",
  },
  async () => {
    const { db } = await import("../lib/db")
    const { chatTurns, chats } = await import("../db/schema")
    const { leaseChatTurn, cancelChatTurn, turnProgress } =
      await import("../lib/chat-jobs.server")
    const { changeCheckpoint, reachCheckpoint } =
      await import("../lib/workflow-checkpoint.server")
    const oldOwner = process.env.SCIENTISTFLOW_INSTALLATION_ID
    const owner = nanoid(),
      chatId = nanoid(),
      id = "workflow_" + nanoid()
    process.env.SCIENTISTFLOW_INSTALLATION_ID = owner
    try {
      await db.batch([
        db.insert(chats).values({ id: chatId, kind: "group" }),
        db.insert(chatTurns).values({
          chatId,
          id,
          owner,
          inputHash: "fixture",
          userMessage: {
            id,
            role: "user",
            parts: [],
            metadata: { checkpoint: initialCheckpoint() },
          },
        }),
      ])
      const first = nanoid()
      assert.equal((await leaseChatTurn(first))?.id, id)
      await changeCheckpoint(chatId, id, { action: "pause" })
      assert.equal((await reachCheckpoint(first))?.phase, "waiting")
      const [parked] = await db
        .select()
        .from(chatTurns)
        .where(eq(chatTurns.chatId, chatId))
      assert.equal(parked.lease, null)
      assert.equal(parked.leaseUntil, null)
      assert.equal(
        (await turnProgress(chatId, id))?.checkpoint?.phase,
        "waiting"
      )
      assert.equal(await leaseChatTurn(nanoid()), undefined)
      const submit = {
        action: "submit" as const,
        note: "@Mira recheck case 6",
        mentionedBotIds: [nanoid()],
      }
      const [a, b] = await Promise.all([
        changeCheckpoint(chatId, id, submit),
        changeCheckpoint(chatId, id, submit),
      ])
      assert.deepEqual(a, b)
      await assert.rejects(
        changeCheckpoint(chatId, id, { ...submit, note: "Different request" }),
        /already changed/
      )
      const resumed = nanoid()
      assert.equal((await leaseChatTurn(resumed))?.id, id)
      assert.equal(await leaseChatTurn(nanoid()), undefined)
      const passed = await reachCheckpoint(resumed)
      assert.deepEqual(passed?.mentionedBotIds, submit.mentionedBotIds)
      assert.equal(passed?.note, submit.note)
      assert.equal(passed?.phase, "passed")
      assert.deepEqual(await reachCheckpoint(resumed), passed)
      assert.deepEqual(await changeCheckpoint(chatId, id, submit), passed)
      await assert.rejects(
        changeCheckpoint(chatId, id, { action: "pause" }),
        /already changed/
      )

      // A separate paused turn can also be cancelled without a worker lease.
      await db
        .update(chatTurns)
        .set({ userMessage: parked.userMessage, lease: null, leaseUntil: null })
        .where(eq(chatTurns.chatId, chatId))
      await cancelChatTurn(chatId, id)
      assert.equal((await turnProgress(chatId, id))?.state, "cancelled")
    } finally {
      await db.delete(chats).where(eq(chats.id, chatId))
      if (oldOwner === undefined)
        delete process.env.SCIENTISTFLOW_INSTALLATION_ID
      else process.env.SCIENTISTFLOW_INSTALLATION_ID = oldOwner
    }
  }
)
