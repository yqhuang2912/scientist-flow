import assert from "node:assert/strict"
import { test } from "node:test"
import type { UIMessage } from "ai"
import {
  formatToolValue,
  getAssistantSegments,
  getHandoff,
  getMessageBotId,
  getToolPresentation,
  groupChatParts,
  safeChatImageUrl,
  safeChatUrl,
  type ChatPart,
  type ChatToolPart,
} from "../lib/chat-presentation"

const handoff: ChatToolPart = {
  type: "tool-handoff",
  toolCallId: "handoff-1",
  state: "output-available",
  input: { botName: "James", reason: "A tutoring question." },
  output: {
    success: true,
    handedOffFrom: { id: "coll", instructions: "PRIVATE SOURCE PROMPT" },
    handedOffTo: {
      id: "james",
      name: "James",
      instructions: "PRIVATE TARGET PROMPT",
    },
    reason: "James can explain the concept.",
    instruction: "PRIVATE MODEL NOTE",
  },
}
const text = (value: string): ChatPart => ({
  type: "text",
  text: value,
  state: "done",
})
const thinking: ChatPart = {
  type: "reasoning",
  text: "Reviewing the question.",
  state: "done",
}
const approval: ChatToolPart = {
  type: "tool-run",
  toolCallId: "approve-1",
  state: "approval-requested",
  input: { command: "check" },
  approval: { id: "decision-1" },
}
const message = (parts: ChatPart[], botId?: string): UIMessage => ({
  id: "message-1",
  role: "assistant",
  metadata: botId ? { botId } : undefined,
  parts,
})

test("handoff preserves chronological parts and attributes earlier text to the sender", () => {
  const parts = [
    text("Let me ask James."),
    thinking,
    handoff,
    { type: "step-start" } as const,
    thinking,
    text("I'm James."),
  ]
  const segments = getAssistantSegments(message(parts, "james"), null)
  assert.deepEqual(
    segments.map((s) => s.botId),
    ["coll", "james"]
  )
  assert.deepEqual(
    segments.map((s) => s.parts.map((p) => p.index)),
    [
      [0, 1, 2],
      [3, 4, 5],
    ]
  )
  assert.deepEqual(
    segments.flatMap((s) => s.parts.map((p) => p.part)),
    parts
  )
})

test("streaming into a recipient keeps the sender segment key stable", () => {
  const initial = getAssistantSegments(
    message([thinking, handoff], "james"),
    null
  )
  const updated = getAssistantSegments(
    message([thinking, handoff, text("Answer")], "james"),
    null
  )
  assert.equal(initial[0].key, updated[0].key)
  assert.equal(initial.length, 1)
  assert.equal(updated[1].botId, "james")
})

test("multiple handoffs retain each intermediate speaker", () => {
  const second: ChatToolPart = {
    ...handoff,
    toolCallId: "handoff-2",
    output: {
      success: true,
      handedOffFrom: { id: "james" },
      handedOffTo: { id: "paul", name: "Paul" },
    },
  }
  assert.deepEqual(
    getAssistantSegments(
      message([handoff, text("James"), second, text("Paul")], "paul"),
      null
    ).map((s) => s.botId),
    ["coll", "james", "paul"]
  )
})

test("failed handoff stays with the original speaker and shows the returned error", () => {
  const failed: ChatToolPart = {
    ...handoff,
    output: { success: false, message: "Member not found" },
  }
  assert.equal(getHandoff(failed), null)
  assert.deepEqual(
    getAssistantSegments(
      message([failed, text("Let me answer")], "coll"),
      null
    ).map((s) => s.botId),
    ["coll"]
  )
  assert.equal(getToolPresentation(failed, false).status, "error")
  assert.equal(getToolPresentation(failed, false).error, "Member not found")
})

test("direct chat uses its bot fallback; unknown group speaker is not silently reassigned", () => {
  assert.equal(
    getAssistantSegments(message([text("Hello")]), "coll")[0].botId,
    "coll"
  )
  assert.equal(
    getAssistantSegments(message([text("Hello")]), null)[0].botId,
    null
  )
  assert.equal(
    getMessageBotId({ ...message([]), metadata: { botId: 42 } }),
    null
  )
})

test("Trace runs end at text, step boundaries, files and approval prompts", () => {
  const file: ChatPart = {
    type: "file",
    mediaType: "text/plain",
    url: "https://example.com/note.txt",
  }
  const parts = [
    thinking,
    handoff,
    text("Answer"),
    thinking,
    approval,
    handoff,
    { type: "step-start" } as const,
    thinking,
    file,
  ]
  const blocks = groupChatParts(parts.map((part, index) => ({ part, index })))
  assert.deepEqual(
    blocks.map((b) => b.kind),
    [
      "activity",
      "content",
      "activity",
      "approval",
      "activity",
      "activity",
      "content",
    ]
  )
  assert.deepEqual(
    blocks.map((b) => b.key),
    [0, 2, 3, 4, 5, 7, 8]
  )
  assert.equal(blocks[0].kind === "activity" && blocks[0].parts.length, 2)
})

test("model-only handoff fields are not passed to the display", () => {
  const display = JSON.stringify(getToolPresentation(handoff, false))
  assert.ok(!display.includes("PRIVATE"))
  assert.ok(display.includes("James can explain"))
  assert.equal(getToolPresentation(handoff, false).output, undefined)
})

test("incomplete tool calls stop animating when the response stops", () => {
  for (const state of ["input-streaming", "input-available"] as const) {
    const part: ChatToolPart = {
      type: "tool-search",
      toolCallId: "t",
      state,
      input: {},
    }
    assert.equal(getToolPresentation(part, true).status, "running")
    assert.equal(getToolPresentation(part, false).status, "pending")
    assert.doesNotMatch(getToolPresentation(part, false).title, /Ran |Running/)
  }
  const partial: ChatToolPart = {
    type: "tool-search",
    toolCallId: "partial",
    state: "output-available",
    input: {},
    output: "Partial result",
    preliminary: true,
  }
  assert.equal(getToolPresentation(partial, false).status, undefined)
  assert.match(getToolPresentation(partial, false).title, /^Partial results/)
})

test("dynamic tools and every terminal state have distinct display states", () => {
  const base = {
    type: "dynamic-tool" as const,
    toolName: "webSearch",
    toolCallId: "t",
    input: {},
  }
  assert.equal(
    getToolPresentation(
      { ...base, state: "output-available", output: false },
      false
    ).title,
    "Ran web Search"
  )
  assert.equal(
    getToolPresentation(
      { ...base, state: "output-error", errorText: "Offline" },
      false
    ).error,
    "Offline"
  )
  assert.match(
    getToolPresentation(
      {
        ...base,
        state: "output-denied",
        approval: { id: "a", approved: false },
      },
      false
    ).title,
    /^Denied/
  )
  assert.match(
    getToolPresentation(
      {
        ...base,
        state: "approval-responded",
        approval: { id: "a", approved: true },
      },
      true
    ).title,
    /^Approved/
  )
  assert.equal(
    getToolPresentation(
      {
        ...base,
        state: "output-available",
        output: "partial",
        preliminary: true,
      },
      true
    ).status,
    "running"
  )
})

test("unsafe source protocols never become clickable links", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<script>",
    "file:///C:/secret",
    "//evil.test",
    "/relative",
    "not a URL",
  ])
    assert.equal(safeChatUrl(url), undefined)
  assert.equal(
    safeChatUrl("https://example.com/paper"),
    "https://example.com/paper"
  )
})

test("inline image output accepts raster images and rejects SVG and HTML", () => {
  assert.ok(safeChatImageUrl("data:image/png;base64,abc", "image/png"))
  assert.ok(safeChatImageUrl("https://example.com/plot.png", "image/png"))
  assert.equal(
    safeChatImageUrl("data:text/html;base64,abc", "image/png"),
    undefined
  )
  assert.equal(
    safeChatImageUrl("https://example.com/plot.svg", "image/svg+xml"),
    undefined
  )
})

test("falsy tool output is preserved and complex output cannot crash serialization", () => {
  assert.equal(formatToolValue(false), "false")
  assert.equal(formatToolValue(0), "0")
  assert.equal(formatToolValue(null), "null")
  assert.equal(formatToolValue(""), "")
  const circular: { self?: unknown } = {}
  circular.self = circular
  assert.equal(formatToolValue(circular), "Unable to display this value.")
})
