import assert from "node:assert/strict"
import { test } from "node:test"
import { botMemoryFormSchema, botMemoryTextLimit } from "../db/schema"

test("confirmed preferences count Unicode code points and accept only editable text", () => {
  const text = "🔬".repeat(botMemoryTextLimit)
  assert.deepEqual(botMemoryFormSchema.parse({ text: "  " + text + "\n" }), {
    text,
  })
  for (const value of [
    { text: text + "字" },
    { text: "  \n " },
    { text: "Preference", botId: "another-bot" },
  ]) {
    assert.equal(botMemoryFormSchema.safeParse(value).success, false)
  }
})
