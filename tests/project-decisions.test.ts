import assert from "node:assert/strict"
import { test } from "node:test"
import type { UIMessage } from "ai"
import {
  getAssistantSegments,
  getToolPresentation,
} from "../lib/chat-presentation"
import { transferredSpeaker } from "../lib/chat-bot-context"
import { projectEvidence } from "../lib/project-evidence"
import {
  projectContextForSteps,
  projectDecisionTool,
} from "../lib/project-decisions"
import type { ProjectDecision } from "../db/schema"

const a = { id: "a", name: "A", job: "Recorder", instructions: null }
const b = { id: "b", name: "B", job: "Reviewer", instructions: null }
const handoff = { success: true, handedOffFrom: a, handedOffTo: b }
const history: UIMessage[] = [
  {
    role: "assistant",
    id: "old",
    metadata: { botId: b.id },
    parts: [
      { type: "text", text: "Source analysis." },
      {
        type: "tool-handoff",
        toolCallId: "h",
        input: {},
        state: "output-available",
        output: handoff,
      },
      { type: "step-start" },
      { type: "reasoning", text: "Hidden rationale." },
      { type: "text", text: "Recipient report." },
    ],
  },
  {
    role: "user",
    id: "current",
    parts: [{ type: "text", text: "Evidence 3/8." }],
  },
]
test("citations resolve only visible passages from the accepted group history, by actual segment speaker", () => {
  const original = structuredClone(history)
  const evidence = projectEvidence("P", history, [a, b])
  const rows = [...evidence.sources.passages.values()]
  assert.deepEqual(
    rows.map((r) => [r.role, r.author, r.text]),
    [
      ["user", "User", "Evidence 3/8."],
      ["assistant", "A", "Source analysis."],
      ["assistant", "B", "Recipient report."],
    ]
  )
  const other = projectEvidence("Q", history, [a, b])
  for (const ref of evidence.sources.passages.keys())
    assert(!other.sources.passages.has(ref))
  const labeled = evidence.labelHistory(history)
  assert.match(JSON.stringify(labeled[1]), /\[S-[0-9a-f]+\] Evidence 3\/8/)
  assert.deepEqual(history, original)
  assert.deepEqual(
    getAssistantSegments(history[0], null).map((s) => s.botId),
    ["a", "b"]
  )
})

test("prepareStep reads committed project state after parallel recording and handoff, failures and withdrawal", async () => {
  const row: ProjectDecision = {
    id: "D-aaaaaaaaaaaaaaaa",
    chatId: "P",
    decision: "Use patient IDs",
    nextStep: "Check overlap",
    creatorBotId: a.id,
    creatorName: a.name,
    sourceMessageId: "current",
    sourcePart: 0,
    sourceRole: "user",
    sourceAuthor: "User",
    quote: "Evidence 3/8.",
    createdAt: new Date(),
    withdrawnAt: null,
  }
  const group = [a, b]
  for (const commit of [false, true]) {
    let db: ProjectDecision[] = []
    const contextForStep = projectContextForSteps(db, async () => db)
    assert(!(await contextForStep(0)).includes(row.id))
    const results = await Promise.all([
      Promise.resolve().then(() => ({ toolName: "handoff", output: handoff })),
      Promise.resolve().then(() => {
        if (commit) db = [row]
        return {
          toolName: projectDecisionTool,
          output: commit ? { success: true, id: row.id } : { success: false },
        }
      }),
    ])
    assert.equal(
      transferredSpeaker([{ toolResults: results }], group)?.id,
      b.id
    )
    const receiver = await contextForStep(1)
    for (const value of [row.id, row.quote, row.decision, row.nextStep!])
      assert.equal(receiver.includes(value), commit)
    db = []
    assert(!(await contextForStep(2)).includes(row.quote))
  }
  await assert.rejects(
    projectContextForSteps([], async () => {
      throw new Error("offline")
    })(1),
    /offline/
  )
})

test("a failed project write never displays a saved receipt", () => {
  const part = {
    type: "tool-record_project_decision",
    toolCallId: "c",
    input: { quote: "private arguments" },
    state: "output-available",
  } as const
  const failed = getToolPresentation(
    { ...part, output: { success: false, error: "Invalid quote" } },
    false
  )
  assert.equal(failed.status, "error")
  assert.equal(failed.input, undefined)
  const saved = getToolPresentation(
    { ...part, output: { success: true, id: "D-123" } },
    false
  )
  assert.match(saved.title, /Saved project decision.*D-123/)
  assert.equal(saved.output, undefined)
})
