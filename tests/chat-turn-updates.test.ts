import assert from "node:assert/strict"
import test from "node:test"
import type { UIMessage } from "ai"
import {
  mergeTurnAck,
  mergeTurnProgress,
  type ChatSnapshot,
  type ChatTurnAck,
} from "../lib/chat-job"

const old: UIMessage = {
  id: "old",
  role: "assistant",
  parts: [{ type: "text", text: "Previous turn" }],
}
const ack: ChatTurnAck = {
  turnId: "turn",
  state: "queued",
  acceptedAt: "2026-01-01T00:00:00.000Z",
  lastMessagePreview: "notes.md",
  userMessage: {
    id: "turn",
    role: "user",
    parts: [
      {
        type: "file",
        filename: "notes.md",
        mediaType: "text/markdown",
        url: "notes.md",
      },
    ],
    metadata: {
      workspaceFiles: {
        0: { relativePath: "docs/notes.md", origin: "workspace" },
      },
    },
  },
}
const initial: ChatSnapshot = { messages: [old], activeId: null, error: null }
const handoff: UIMessage = {
  role: "assistant",
  id: "sender",
  parts: [
    {
      type: "tool-handoff",
      toolCallId: "handoff-1",
      state: "output-available",
      input: {},
      output: { success: true },
    },
  ],
}
const evidence: UIMessage = {
  role: "assistant",
  id: "recipient",
  parts: [
    {
      type: "tool-measure",
      toolCallId: "measure-1",
      state: "output-available",
      input: {},
      output: { value: 12 },
    },
  ],
}

test("acknowledgements and turn progress merge by message ID and keep the final evidence", () => {
  const accepted = mergeTurnAck(initial, ack)
  const partial = mergeTurnProgress(accepted, {
    turnId: ack.turnId,
    state: "running",
    replies: [handoff],
    error: null,
  })
  assert.equal(mergeTurnAck(partial, ack), partial)
  const finalMessage: UIMessage = {
    ...evidence,
    parts: [...evidence.parts, { type: "text", text: "12 ms" }],
  }
  const streaming = mergeTurnProgress(partial, {
    turnId: ack.turnId,
    state: "running",
    replies: [handoff, evidence],
    error: null,
  })
  const final = {
    turnId: ack.turnId,
    state: "completed" as const,
    replies: [handoff, finalMessage],
    error: null,
  }
  const settled = mergeTurnProgress(streaming, final)
  assert.deepEqual(settled.messages, [
    old,
    ack.userMessage,
    handoff,
    finalMessage,
  ])
  assert.equal(settled.messages[0], old)
  assert.equal(settled.activeId, null)
  assert.equal(mergeTurnAck(settled, ack), settled)
  assert.equal(
    mergeTurnProgress(settled, { ...final, state: "running", replies: [] }),
    settled
  )
  const replay = mergeTurnAck(initial, { ...ack, state: "completed" }, final)
  assert.deepEqual(replay, settled)
  assert.equal(mergeTurnAck(replay, ack, final), replay)
})

test("a previous turn's late failure cannot interrupt the current turn", () => {
  const next: ChatSnapshot = {
    messages: [
      ack.userMessage,
      handoff,
      { id: "new", role: "user", parts: [] },
    ],
    activeId: "new",
    error: null,
  }
  assert.equal(
    mergeTurnProgress(next, {
      turnId: ack.turnId,
      state: "failed",
      error: "Late failure",
      replies: [],
    }),
    next
  )
  assert.equal(mergeTurnAck(next, ack), next)
  const failed = mergeTurnProgress(next, {
    turnId: "new",
    state: "failed",
    replies: [evidence],
    error: "Interrupted",
  })
  assert.equal(failed.activeId, null)
  assert.equal(failed.error, "Interrupted")
  assert.deepEqual(failed.messages, [...next.messages, evidence])
})
