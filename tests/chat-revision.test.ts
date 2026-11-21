import assert from "node:assert/strict"
import { test } from "node:test"
import type { UIMessage } from "ai"
import { chatTurnGroups, projectReplyVersions } from "../lib/chat-revision"

test("a revised earlier turn retains its slot and immutable attempts across later replies", () => {
  const user = (id: string, revises?: string): UIMessage => ({
    id,
    role: "user",
    parts: [],
    metadata: { revises },
  })
  const reply = (id: string): UIMessage => ({
    id,
    role: "assistant",
    parts: [],
  })
  const messages = [
    user("a"),
    reply("first"),
    user("b"),
    reply("later"),
    user("edit", "a"),
    reply("second"),
    user("retry", "edit"),
    reply("third"),
  ]
  const [a, b] = chatTurnGroups(messages)
  assert.deepEqual(
    a.current.map((m) => m.id),
    ["retry", "third"]
  )
  assert.deepEqual(
    a.previous.map((turn) => turn.map((m) => m.id)),
    [
      ["a", "first"],
      ["edit", "second"],
    ]
  )
  assert.deepEqual(
    b.current.map((m) => m.id),
    ["b", "later"]
  )
  assert.deepEqual(b.previous, [])
})

test("a reply retry only versions its own speaker and the selected version enters future context", () => {
  const user = (id: string, metadata?: object): UIMessage => ({
    id,
    role: "user",
    parts: [],
    metadata,
  })
  const bot = (id: string): UIMessage => ({ id, role: "assistant", parts: [] })
  const replyRetry = { turnId: "question", replyId: "second" }
  const history = [
    user("question"),
    bot("first"),
    bot("second"),
    user("later"),
    bot("later-reply"),
    user("r1", { replyRetry }),
    bot("v2"),
    user("r2", { replyRetry, replyChoice: "v2" }),
    bot("v3"),
  ]
  const view = projectReplyVersions(history)
  assert.deepEqual(
    view.messages.map((m) => m.id),
    ["question", "first", "v2", "later", "later-reply"]
  )
  assert.deepEqual(
    view.byMessage.get("second")?.replies.map((m) => m.id),
    ["second", "v2", "v3"]
  )
  assert.equal(view.byMessage.get("first")?.replies.length, 1)
  const next = projectReplyVersions([
    ...history,
    user("r3", { replyRetry }),
    bot("v4"),
  ])
  assert.equal(next.messages[2].id, "v4")
})
