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
