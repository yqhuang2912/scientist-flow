import assert from "node:assert/strict"
import { test } from "node:test"
import { chatMessagePreview } from "../lib/chat-preview"
import { mergeChatAcceptance } from "../lib/chat-recency"

const files = [
  {
    name: "核对表.txt",
    relativePath: "uploads/internal-copy.txt",
    size: 5,
    mediaType: "text/plain",
  },
]
const workspacePaths = ["docs/内部目录/审阅 [1].md", "src/报告.txt"]

test("preview uses the submitted text, normalizes whitespace and truncates at a grapheme boundary", () => {
  assert.equal(
    chatMessagePreview({ text: "  测试\t\n  问题　123 ", files }),
    "测试 问题 123"
  )
  const cluster = "👩🏽‍🔬"
  assert.equal(
    chatMessagePreview({ text: cluster.repeat(80), files }),
    cluster.repeat(80)
  )
  assert.equal(
    chatMessagePreview({ text: cluster.repeat(81), files }),
    cluster.repeat(79) + "…"
  )
  assert.equal(
    chatMessagePreview({ text: "a" + "\u0301".repeat(9000), files }),
    "…"
  )
})

test("late or duplicate acknowledgements retain the latest preview and time for each chat", () => {
  const first = {
    chatId: "a",
    acceptedAt: "2026-11-21T11:00:00.101Z",
    lastMessagePreview: "M1",
  }
  const second = {
    ...first,
    acceptedAt: "2026-11-21T11:00:00.102Z",
    lastMessagePreview: "M2",
  }
  const other = { ...first, chatId: "b", lastMessagePreview: "other" }
  const before = mergeChatAcceptance({ b: other }, first)
  const after = mergeChatAcceptance(before, second)
  assert.deepEqual(after, { a: second, b: other })
  assert.equal(mergeChatAcceptance(after, first), after)
  assert.equal(mergeChatAcceptance(after, second), after)
  assert.deepEqual(mergeChatAcceptance({ b: other }, second), after)
})

test("attachment-only and Workspace-only messages use display filenames", () => {
  assert.equal(chatMessagePreview({ text: "", files }), "核对表.txt")
  assert.equal(
    chatMessagePreview({ text: "", files, workspacePaths }),
    "核对表.txt 等 3 个文件"
  )
  assert.equal(
    chatMessagePreview({ text: " ", files: [], workspacePaths }),
    "审阅 [1].md 等 2 个文件"
  )
  assert.equal(
    chatMessagePreview({
      text: "@docs/内部目录/审阅 [1].md\n @src/报告.txt ",
      files: [],
      workspacePaths,
    }),
    "审阅 [1].md 等 2 个文件"
  )
})

test("selected Workspace mentions in prose retain the basename and surrounding text", () => {
  assert.equal(
    chatMessagePreview({
      text: "请比较 @docs/内部目录/审阅 [1].md 和 @src/报告.txt。",
      workspacePaths,
      files,
    }),
    "请比较 @审阅 [1].md 和 @报告.txt。"
  )
  assert.equal(
    chatMessagePreview({
      text: "@reports/summary.md.bak",
      workspacePaths: ["reports/summary.md"],
      files: [],
    }),
    "@reports/summary.md.bak"
  )
})
