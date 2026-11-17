import assert from "node:assert/strict"
import { test } from "node:test"
import { convertToModelMessages, type UIMessage } from "ai"
import {
  attributeBotMessages,
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
  const attributed = attributeBotMessages(history, context.bots)
  const modelMessages = await convertToModelMessages(attributed)
  assert.match(
    JSON.stringify(modelMessages[1].content),
    /Historical assistant speaker.*Coll/
  )
  assert.match(
    JSON.stringify(modelMessages[2].content),
    /User addressed.*James/
  )
  assert.deepEqual(history, original)
  // Repeated reads/retries cannot stack prefixes in persisted messages.
  assert.deepEqual(attributeBotMessages(history, context.bots), attributed)
})

test("handoff history distinguishes source text, target text and preserves the tool result", () => {
  const toolPart = {
    type: "tool-handoff",
    toolCallId: "handoff-1",
    state: "output-available",
    input: { botName: "James", reason: "Tutoring" },
    output: { success: true, handedOffFrom: coll, handedOffTo: james },
  } as const
  const history: UIMessage[] = [
    {
      id: "a1",
      role: "assistant",
      metadata: { botId: "james" },
      parts: [
        { type: "text", text: "Let me ask James." },
        toolPart,
        { type: "text", text: "Let's learn step by step." },
      ],
    },
  ]
  const result = attributeBotMessages(history, context.bots)[0]
  assert.match(JSON.stringify(result.parts[0]), /speaker.*Coll/)
  assert.equal(result.parts[1], toolPart)
  assert.match(JSON.stringify(result.parts[2]), /speaker.*James/)
})

test("unattributed legacy replies never inherit the currently selected bot", () => {
  const result = attributeBotMessages(
    [
      {
        id: "old",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
      },
    ],
    [james]
  )
  assert.match(JSON.stringify(result), /unspecified bot/)
  assert.doesNotMatch(JSON.stringify(result), /James/)
})

test("handoff prompt keeps the target identity and disables a second handoff", () => {
  const system = botInstructions(james, context, { handoffAvailable: false })
  assert.match(system, /Do not hand off again/)
  assert.match(system, /answering this turn as "James", "Tutor"/)
})
