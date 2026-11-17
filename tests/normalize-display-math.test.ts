import assert from "node:assert/strict"
import { test } from "node:test"
import { normalizeDisplayMath } from "../lib/normalize-display-math"

test("a whole-line $$…$$ becomes a block", () => {
  assert.equal(
    normalizeDisplayMath(String.raw`$$\frac{1}{2}$$`),
    "$$\n\\frac{1}{2}\n$$"
  )
})

test("indentation is preserved on all three lines", () => {
  assert.equal(normalizeDisplayMath("  $$x$$"), "  $$\n  x\n  $$")
})

test("math inside a sentence is left inline", () => {
  const input = String.raw`See $$x$$ here.`
  assert.equal(normalizeDisplayMath(input), input)
})

test("already-blocked math is unchanged", () => {
  const input = "$$\nx\n$$"
  assert.equal(normalizeDisplayMath(input), input)
})

test("empty and bare delimiters are left alone", () => {
  assert.equal(normalizeDisplayMath("$$$$"), "$$$$")
  assert.equal(normalizeDisplayMath("$$"), "$$")
})

test("fenced code is never rewritten", () => {
  const input = "```\n$$x$$\n```"
  assert.equal(normalizeDisplayMath(input), input)
})

test("a longer fence is not closed by a shorter run inside it", () => {
  const input = "````\n```\n$$x$$\n````"
  assert.equal(normalizeDisplayMath(input), input)
})

test("tilde fences are not closed by backticks", () => {
  const input = "~~~\n```\n$$x$$\n~~~"
  assert.equal(normalizeDisplayMath(input), input)
})

test("math after a closed fence is still rewritten", () => {
  assert.equal(
    normalizeDisplayMath("```\ncode\n```\n$$x$$"),
    "```\ncode\n```\n$$\nx\n$$"
  )
})

test("a line holding two formulas is left alone", () => {
  const input = "$$a$$ and $$b$$"
  assert.equal(normalizeDisplayMath(input), input)
})
