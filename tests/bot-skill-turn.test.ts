import assert from "node:assert/strict"
import test from "node:test"
import type { ModelMessage, UIMessage } from "ai"
import { botFormSchema } from "../db/schema"
import { pastRead, skillTurn } from "../lib/bot-skill-turn"
import {
  getAssistantSegments,
  getSkillReadPresentation,
  type ChatToolPart,
} from "../lib/chat-presentation"

const definition = {
  id: "skill-1",
  name: "outline",
  description: "Design a proposal.",
  instructions: "## Verification\nprivate body",
  updatedAt: new Date("2026-01-01"),
  botId: "designer",
}
const fields = { name: "A", avatar: "a", job: "design" }
test("saving requires an explicit set of valid IDs, allows clearing, and deduplicates", () => {
  const id = "s".repeat(21)
  assert.equal(botFormSchema.safeParse(fields).success, false)
  assert.equal(
    botFormSchema.safeParse({ ...fields, skillIds: ["not-an-id"] }).success,
    false
  )
  assert.deepEqual(
    botFormSchema.parse({ ...fields, skillIds: [id, id] }).skillIds,
    [id]
  )
  assert.deepEqual(
    botFormSchema.parse({ ...fields, skillIds: [] }).skillIds,
    []
  )
})
test("snapshot catalogs and reads are scoped to the server-selected speaker", () => {
  const turn = skillTurn([definition])
  assert.doesNotMatch(turn.catalog("intake"), /outline|private body/)
  assert.match(turn.catalog("designer"), /outline/)
  assert.doesNotMatch(turn.catalog("designer"), /private body/)
  assert.equal(turn.read("intake", "outline", "denied").success, false)
  assert.equal(turn.read("designer", "unknown", "missing").success, false)
  assert.equal(turn.content("denied"), undefined)
  const receipt = turn.read("designer", "outline", "allowed")
  assert.equal(receipt.skillId, definition.id)
  assert.equal(receipt.version, definition.updatedAt.toISOString())
  assert.match(turn.content("allowed")!, /private body/)
  assert.doesNotMatch(JSON.stringify(receipt), /private body/)
  const messages: ModelMessage[] = [
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "read_skill",
          toolCallId: "allowed",
          output: { type: "text", value: turn.content("allowed")! },
        },
      ],
    },
  ]
  assert.deepEqual(turn.forSpeaker(messages, "designer"), messages)
  assert.match(
    JSON.stringify(turn.forSpeaker(messages, "intake")),
    new RegExp(pastRead)
  )
  assert.doesNotMatch(
    JSON.stringify(turn.forSpeaker(messages, "intake")),
    /private body/
  )
  assert.equal(skillTurn([]).content("allowed"), undefined)
})
test("skill trace follows tool state and same-step reads remain with the handoff sender", () => {
  const input = { name: "outline" }
  const base = { type: "tool-read_skill" as const, toolCallId: "r", input }
  const running: ChatToolPart = { ...base, state: "input-available" }
  const failed: ChatToolPart = {
    ...base,
    state: "output-available",
    output: { success: false, botId: "intake", name: "outline" },
  }
  const read: ChatToolPart = {
    ...base,
    state: "output-available",
    output: {
      success: true,
      botId: "designer",
      name: "outline",
      skillId: "internal-id",
    },
  }
  assert.equal(getSkillReadPresentation(running, true)?.status, "running")
  assert.equal(getSkillReadPresentation(failed, false)?.status, "error")
  assert.equal(
    getSkillReadPresentation(read, false)?.title,
    "已读取 Skill · outline"
  )
  assert.doesNotMatch(
    JSON.stringify(getSkillReadPresentation(read, false)),
    /internal-id/
  )
  const handoff: ChatToolPart = {
    type: "tool-handoff",
    toolCallId: "h",
    input: {},
    state: "output-available",
    output: {
      success: true,
      handedOffFrom: { id: "intake" },
      handedOffTo: { id: "designer", name: "Designer" },
    },
  }
  const msg: UIMessage = {
    id: "m",
    role: "assistant",
    parts: [handoff, failed, { type: "step-start" }, read],
  }
  assert.deepEqual(
    getAssistantSegments(msg, null).map((s) => [
      s.botId,
      s.parts.map((p) => p.index),
    ]),
    [
      ["intake", [0, 1]],
      ["designer", [2, 3]],
    ]
  )
})
