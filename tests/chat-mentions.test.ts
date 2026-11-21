import assert from "node:assert/strict"
import { test } from "node:test"
import {
  mentionQuery,
  mentionTargets,
  rebaseMentions,
  type Mention,
} from "../lib/chat-mentions"
import { chatJobInput } from "../lib/chat-job"
import { nanoid } from "nanoid"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { visit } from "unist-util-visit"
import { rehypeChatMentions } from "../lib/rehype-chat-mentions"

test("sent messages style bot names and referenced workspace paths inline", () => {
  const mentionsIn = (text: string, names: string[]) => {
    const markdown = unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeChatMentions, { labels: names })
    const tree = markdown.runSync(markdown.parse(text))
    const labels: string[] = []
    visit(tree, "element", (node) => {
      if (
        node.tagName === "chat-mention" &&
        node.children[0]?.type === "text"
      )
        labels.push(node.children[0].value)
    })
    return labels
  }
  assert.deepEqual(mentionsIn("请@小林 核对数字。", ["小林"]), ["小林"])
  const markdownFilename = "docs/[审稿](v2)_final_.md"
  assert.deepEqual(
    mentionsIn("核对 @" + markdownFilename + "。", [markdownFilename]),
    [markdownFilename]
  )
  assert.deepEqual(
    mentionsIn(
      "@Iris 请比较 @Iris/审稿 意见 (2).docx 和 @README.md。\n\n@README.md.bak 与 `@README.md`",
      ["Iris", "README.md", "Iris/审稿 意见 (2).docx"]
    ),
    ["Iris", "Iris/审稿 意见 (2).docx", "README.md"]
  )
  assert.deepEqual(
    mentionsIn(
      "请 **@Iris** 与 @Iris Chen 核对。\n\n再请@R&D (2) 回答 @Iris。",
      ["Iris", "Iris Chen", "R&D (2)"]
    ),
    ["Iris", "Iris Chen", "R&D (2)", "Iris"]
  )
  assert.deepEqual(
    mentionsIn(
      "x@Iris.com @docs/@Iris.md @Iris/file @Iris.csv @Iris2 @Rowan `@Iris` [@Iris](https://example.org)\n\n```\n@Iris\n```",
      ["Iris"]
    ),
    []
  )
})

test("mention lookup follows the caret, supports Chinese and spaces, and skips email addresses", () => {
  assert.deepEqual(mentionQuery("请@Audit B later", 9, []), {
    start: 1,
    query: "Audit B",
  })
  assert.equal(mentionQuery("ask iris@example", 16, []), null)
  assert.equal(mentionQuery("@a\ntext", 7, []), null)
})

test("edits rebase selected occurrences and only intact references are sent in text order", () => {
  const a: Mention = {
    kind: "bot",
    value: "second-id",
    label: "Sam",
    start: 0,
    end: 4,
  }
  const b: Mention = { ...a, value: "first-id", start: 5, end: 9 }
  const f: Mention = {
    kind: "file",
    value: "docs/a b.py",
    label: "docs/a b.py",
    start: 10,
    end: 22,
  }
  const text = "@Sam @Sam @docs/a b.py"
  assert.deepEqual(mentionTargets([f, b, a, a]), {
    mentionedBotIds: ["second-id", "first-id"],
    workspacePaths: ["docs/a b.py"],
  })
  assert.equal(mentionQuery(text, text.length, [f]), null)
  const next = rebaseMentions(text, "See " + text, 4, [a, b, f])
  assert.deepEqual(
    next.map((m) => m.start),
    [4, 9, 14]
  )
  assert.deepEqual(
    rebaseMentions(text, text.slice(5), 0, [a, b, f]).map((m) => m.value),
    [b.value, f.value]
  )
  assert.deepEqual(rebaseMentions("@Sam", "@Sams", 5, [a]), [])
})

test("a turn rejects duplicate recipients, ambiguous primary recipients and invalid file paths", () => {
  const botId = nanoid(),
    other = nanoid()
  const input = {
    id: nanoid(),
    text: "Review",
    botId,
    workspacePaths: ["docs/测量.py"],
  }
  assert.ok(
    chatJobInput.safeParse({ ...input, mentionedBotIds: [botId, other] })
      .success
  )
  for (const ids of [[botId, botId], [other, botId], []])
    assert.equal(
      chatJobInput.safeParse({ ...input, mentionedBotIds: ids }).success,
      false
    )
  assert.equal(
    chatJobInput.safeParse({ ...input, workspacePaths: ["../other.txt"] })
      .success,
    false
  )
})
