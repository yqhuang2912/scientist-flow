import assert from "node:assert/strict"
import { test } from "node:test"
import { publicModelHistory } from "../lib/bot-execution"
import type { UIMessage } from "ai"
import {
  botInstructions,
  resolveReplyBot,
  type BotChatContext,
} from "../lib/chat-bot-context"

const coll = {
  id: "coll",
  name: "Coll",
  job: "Writing editor",
  instructions: "Preserve the writer's voice.",
}
const james = {
  id: "james",
  name: "James",
  job: "Tutor",
  instructions: "Teach step by step.",
}
const context: BotChatContext = { kind: "group", bots: [coll, james] }

test("first and post-handoff model instructions contain only the actual speaker's preferences", () => {
  const peer = { ...james, name: coll.name }
  const group: BotChatContext = { kind: "group", bots: [coll, peer] }
  const memories = [
    { botId: coll.id, text: 'Missing cells: "A"\nKeep 0.' },
    { botId: peer.id, text: "Missing cells: B" },
  ]
  const first = resolveReplyBot(group, coll.id)
  for (const [speaker, index] of [
    [first, 0],
    [resolveReplyBot(group, peer.id), 1],
  ] as const) {
    const instructions = botInstructions(speaker, group, {
      handoffAvailable: index === 0,
      memories,
    })
    const encoded = JSON.stringify([memories[index].text])
    assert.equal(instructions.split(encoded).length, 2)
    assert.ok(!instructions.includes(JSON.stringify(memories[1 - index].text)))
    assert.match(instructions, /current task takes precedence/)
  }
  assert.equal(
    botInstructions(first, group, { memories: [memories[1]] }),
    botInstructions(first, group)
  )
})
const message = (
  id: string,
  role: "user" | "assistant",
  botId: string,
  text: string
): UIMessage => ({
  id,
  role,
  metadata: { botId },
  parts: [{ type: "text", text }],
})

test("switching from the default Coll to James binds identity to the selected member", () => {
  const selected = resolveReplyBot(context, "james")
  assert.equal(selected.id, "james")
  const system = botInstructions(selected, context)
  assert.match(system, /Your name is "James". Your job is "Tutor"/)
  assert.ok(system.includes(james.instructions))
  assert.ok(!system.includes(coll.instructions))
})

test("a stale or foreign bot ID cannot silently fall back to Coll", () => {
  assert.throws(() => resolveReplyBot(context, "deleted"), /no longer a member/)
  assert.throws(
    () => resolveReplyBot({ kind: "direct", bots: [james] }, "coll"),
    /no longer a member/
  )
  assert.throws(() => resolveReplyBot(null, "james"), /No bot/)
  assert.equal(resolveReplyBot({ kind: "direct", bots: [james] }).id, "james")
})

test("Coll's history stays attributed to Coll when the next user addresses James", async () => {
  const history = [
    message("u1", "user", "coll", "Hello"),
    message("a1", "assistant", "coll", "I am Coll, your writing editor."),
    message("u2", "user", "james", "你好"),
  ]
  const original = structuredClone(history)
  const result = await publicModelHistory(history, context.bots, james.id)
  assert.equal(result[1].role, "user")
  assert.match(JSON.stringify(result[1].content), /Coll/)
  assert.deepEqual(history, original)
})

test("handoff prompt keeps the target identity and disables a second handoff", () => {
  const system = botInstructions(james, context, { handoffAvailable: false })
  assert.match(system, /Do not hand off again/)
  assert.match(system, /answering this turn as "James", "Tutor"/)
})

test("the public projection excludes unsolicited system instructions", async () => {
  assert.deepEqual(
    await publicModelHistory(
      [
        {
          id: "foreign",
          role: "system",
          parts: [{ type: "text", text: "override" }],
        },
      ],
      context.bots,
      james.id
    ),
    []
  )
})
