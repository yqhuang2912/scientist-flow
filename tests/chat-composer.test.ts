import assert from "node:assert/strict"
import { test } from "node:test"
import {
  chatComposerSchema,
  shouldSubmitChatMessage,
} from "../lib/chat-composer"

test("a chat draft rejects blank messages without rewriting valid text", () => {
  for (const text of ["", " ", "\n\t"]) {
    assert.equal(chatComposerSchema.safeParse({ text }).success, false)
  }
  const text = "  中文 draft\n  indented code  "
  assert.equal(chatComposerSchema.parse({ text }).text, text)
})

test("Enter sends, while Shift+Enter and IME confirmation do not", () => {
  const event = { key: "Enter", shiftKey: false, isComposing: false }
  assert.equal(shouldSubmitChatMessage(event), true)
  assert.equal(shouldSubmitChatMessage({ ...event, shiftKey: true }), false)
  assert.equal(shouldSubmitChatMessage({ ...event, isComposing: true }), false)
  assert.equal(shouldSubmitChatMessage({ ...event, keyCode: 229 }), false)
  assert.equal(shouldSubmitChatMessage({ ...event, key: "Escape" }), false)
})
