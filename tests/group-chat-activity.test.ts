import assert from "node:assert/strict"
import { test } from "node:test"
import type { UIMessage } from "ai"
import {
  getAssistantSegments,
  groupChatParts,
  type ChatPart,
  type ChatToolPart,
} from "../lib/chat-presentation"
import { groupActivities } from "../lib/group-chat-activity"
import { toolCallAnchor } from "../lib/project-decisions"

function tool(name: string, id: string, output: unknown): ChatToolPart {
  return {
    type: "dynamic-tool",
    toolName: name,
    toolCallId: id,
    state: "output-available",
    input: { note: "PRIVATE_INPUT" },
    output,
  }
}
function call(id: string, success = true) {
  return tool("quality", id, {
    kind: "shared-http",
    success,
    toolCallId: id,
    name: "quality",
    displayName: "重建质量",
    botId: "b",
    digest: "digest-" + id,
    body: { note: "PRIVATE_RESPONSE" },
  })
}
function save(id: string, value: number, sourceMessageId = "message") {
  return tool("record_project_decision", "save-" + id, {
    success: true,
    id: "D-0123456789abcdef",
    sourceMessageId,
    toolEvidence: {
      executionId: "execution",
      toolId: "quality-id",
      toolName: "quality",
      toolCallId: id,
      digest: "digest-" + id,
      fields: [
        { path: "/psnr", value },
        { path: "/unit", value: "dB" },
      ],
    },
  })
}
function message(parts: ChatPart[]): UIMessage {
  return {
    id: "message",
    role: "assistant",
    metadata: { botId: "b", executionId: "execution" },
    parts,
  }
}
function summaries(parts: ChatPart[], active = false) {
  const m = message(parts)
  return groupActivities(
    m,
    getAssistantSegments(m, null)[0].parts,
    "Rowan",
    "b",
    active
  )
}
test("two receipts of the same tool retain their own values and message-scoped links in live and replay", () => {
  const parts = [call("one"), call("two"), save("two", 33.5), save("one", 32.4)]
  const rows = summaries(parts)
  assert.deepEqual(summaries(parts, true), rows)
  for (const [id, value] of [
    ["one", 32.4],
    ["two", 33.5],
  ]) {
    const row = rows.get(String(id))!
    assert.equal(row.title, "Rowan 已调用 Tool「重建质量」。")
    assert.equal(row.result, "结果：psnr " + value + " dB。")
    assert.equal(
      rows.get("save-" + id)?.sourceAnchor,
      toolCallAnchor("message", String(id))
    )
  }
})
test("only a matching successful observation can supply fields and a source link", () => {
  const source = call("one")
  assert.ok(source.state === "output-available")
  const receipt = source.output as object
  for (const [observed, saved] of [
    [source, save("one", 23, "other")],
    [source, save("two", 23)],
    [call("one", false), save("one", 23)],
    [{ ...source, preliminary: true }, save("one", 23)],
    ...[
      { botId: "a" },
      { digest: "other" },
      { toolCallId: "other" },
      { name: "other" },
    ].map((override) => [
      tool("quality", "one", { ...receipt, ...override }),
      save("one", 23),
    ]),
  ] as ChatToolPart[][]) {
    const rows = summaries([observed, saved])
    assert.equal(rows.get(observed.toolCallId)?.result, undefined)
    assert.equal(rows.get(saved.toolCallId)?.sourceAnchor, undefined)
  }
  assert.equal(
    summaries([source]).get("one")?.title,
    "Rowan 的 Tool「重建质量」调用已完成。"
  )
})

test("a named metric uses its observed unit; diagnostic fields do not become results", () => {
  const saved = save("one", 32.4)
  assert.ok(saved.state === "output-available")
  const output = saved.output as {
    toolEvidence: { fields: { path: string; value: string | number }[] }
  }
  const diagnostics = [
    { path: "/debug/log", value: "PRIVATE_STACK" },
    { path: "/response", value: '{"private":"PRIVATE_BODY"}' },
  ]
  output.toolEvidence.fields = [
    { path: "/samples/0/metric", value: "PSNR" },
    { path: "/samples/0/value", value: 32.4 },
    { path: "/samples/0/unit", value: "dB" },
    ...diagnostics,
  ]
  assert.equal(
    summaries([call("one"), saved]).get("one")?.result,
    "结果：PSNR 32.4 dB。"
  )
  output.toolEvidence.fields = diagnostics
  assert.equal(summaries([call("one"), saved]).get("one")?.result, undefined)
})
test("pending, approved, rejected and failed calls expose only their actor, action and state", () => {
  const base = {
    type: "tool-lookup" as const,
    toolCallId: "g",
    input: { debug: "PRIVATE_INPUT" },
  }
  for (const [part, active, title] of [
    [
      { ...base, state: "input-available" },
      true,
      "Rowan 正在调用 Tool「lookup」。",
    ],
    [
      { ...base, state: "input-available" },
      false,
      "Rowan 调用 Tool「lookup」尚未完成。",
    ],
    [
      {
        ...base,
        state: "approval-requested",
        approval: { id: "approval", requestReason: "PRIVATE_REASON" },
      },
      false,
      "Rowan 请求批准调用 Tool「lookup」。",
    ],
    [
      {
        ...base,
        state: "approval-responded",
        approval: { id: "approval", approved: true },
      },
      true,
      "Rowan 调用 Tool「lookup」已获批准，等待执行。",
    ],
    [
      {
        ...base,
        state: "output-denied",
        approval: { id: "approval", approved: false },
      },
      false,
      "Rowan 调用 Tool「lookup」未获批准。",
    ],
    [
      { ...base, state: "output-error", errorText: "PRIVATE_STACK" },
      false,
      "Rowan 调用 Tool「lookup」失败。",
    ],
    [
      tool("lookup", "g", { success: false, data: "PRIVATE_RESPONSE" }),
      false,
      "Rowan 调用 Tool「lookup」失败。",
    ],
    [
      tool("lookup", "g", { data: "PRIVATE_RESPONSE" }),
      false,
      "Rowan 的 Tool「lookup」调用已完成。",
    ],
  ] as [ChatToolPart, boolean, string][]) {
    const row = summaries([part], active).get("g")!
    assert.equal(row.title, title)
    assert.doesNotMatch(JSON.stringify(row), /PRIVATE/)
    assert.ok(!row.result && !row.sourceAnchor && !row.decisionId)
  }
  const denied = summaries([
    tool("record_project_decision", "save", {
      success: false,
      id: "D-0123456789abcdef",
    }),
  ]).get("save")!
  assert.equal(denied.status, "error")
  assert.equal(denied.decisionId, undefined)
})
test("group hides thought parts after resolving handoff ownership and retains public text indices", () => {
  const parts: ChatPart[] = [
    tool("handoff", "handoff", {
      success: true,
      handedOffFrom: { id: "a", name: "Iris" },
      handedOffTo: { id: "b", name: "Rowan" },
    }),
    { type: "reasoning", state: "streaming", text: "PRIVATE_THOUGHT" },
    tool("read_skill", "read", {
      success: true,
      name: "重建质量核验",
      instructions: "PRIVATE_INSTRUCTIONS",
    }),
    { type: "text", text: "**公开结论**\n\n```py\nprint(1)\n```" },
  ]
  const m: UIMessage = { ...message(parts), metadata: { botId: "b" } }
  const [a, b] = getAssistantSegments(m, null)
  assert.equal(a.botId, "a")
  assert.equal(b.botId, "b")
  assert.equal(
    groupActivities(m, a.parts, "Iris", a.botId, false).get("handoff")?.title,
    "Iris 将任务交给 Rowan。"
  )
  assert.equal(
    groupActivities(m, b.parts, "Rowan", b.botId, false).get("read")?.title,
    "Rowan 已读取 Skill「重建质量核验」。"
  )
  assert.deepEqual(
    groupChatParts(b.parts, true).map((x) => [x.kind, x.key]),
    [
      ["activity", 2],
      ["content", 3],
    ]
  )
})
