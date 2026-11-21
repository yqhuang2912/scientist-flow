import test from "node:test"
import assert from "node:assert/strict"
import type { UIMessage } from "ai"
import { applyTextFrame, withLiveText } from "../lib/chat-live"
import { chatMarker, type ChatActivityRow } from "../lib/chat-activity-status"

test("growing replies survive overlapping polls and duplicated frames until the verified receipt replaces them", () => {
  const prefix = { id: "r", botId: "mira", part: 0, text: "第一段", offset: 0 }
  const tail = { ...prefix, offset: 3, text: "以及第二段" }
  const draft = applyTextFrame(prefix, tail)!
  assert.deepEqual(applyTextFrame(draft, tail), draft)
  const partial: UIMessage = {
    id: "r",
    role: "assistant",
    parts: [{ type: "text", text: prefix.text, state: "streaming" }],
  }
  const merged = withLiveText([partial], [prefix, draft])
  assert.equal(merged.length, 1)
  assert.equal(
    merged[0].parts[0].type === "text" && merged[0].parts[0].text,
    prefix.text + tail.text
  )
  const verified = {
    ...partial,
    metadata: { artifact: { path: "outputs/docs/report.md" } },
  }
  assert.deepEqual(withLiveText([verified], [draft]), [verified])
  assert.deepEqual(
    applyTextFrame(undefined, { ...prefix, offset: 10 }),
    undefined
  )
})

test("running, paused, unread and seen states follow each chat's own turn", () => {
  const row: ChatActivityRow = {
    chatId: "group",
    turnId: "turn",
    state: "running",
    waiting: false,
    hasReply: false,
  }
  assert.equal(chatMarker(row, null), "running")
  assert.equal(chatMarker({ ...row, waiting: true }, null), "waiting")
  const done = { ...row, state: "completed" as const, hasReply: true }
  assert.equal(chatMarker(done, "older-turn"), "unread")
  assert.equal(chatMarker(done, row.turnId), undefined)
  assert.equal(chatMarker({ ...done, state: "failed" }, null), undefined)
  assert.equal(chatMarker({ ...done, hasReply: false }, null), undefined)
})
