import assert from "node:assert/strict"
import { test } from "node:test"
import { GroupReplyStream, groupReplyOutput } from "../lib/group-reply-stream"

const id = "public-reply"
const toolName = groupReplyOutput.name
const start = { type: "tool-input-start", id, toolName } as const
const delta = (piece: string) =>
  ({ type: "tool-input-delta", id, delta: piece }) as const
const final = (input: string) =>
  ({ type: "tool-call", toolCallId: id, toolName, input }) as const

test("a long Markdown reply decodes exactly across every JSON and UTF-16 boundary", async () => {
  const paragraph = '# 中文 🔬🧪\r\n- **结果**："0.42" / C:\\data\\框\n\t\b\f'
  const text = paragraph.repeat(800)
  // One literal emoji, one escaped surrogate pair, and an escaped property name.
  const value = JSON.stringify(text)
    .replaceAll("中", "\\u4E2D")
    .replaceAll("🔬", "\\uD83D\\uDD2C")
    .replaceAll("/", "\\/")
  const input = ' \n{ "\\u0074ext"\t:\r' + value + " } "
  const output: string[] = []
  const stream = new GroupReplyStream((piece) => {
    assert.ok(piece.isWellFormed(), "Published an incomplete surrogate pair")
    output.push(piece)
  })
  await stream.consume(start)
  for (let pos = 0; pos < input.length; pos++)
    await stream.consume(delta(input[pos]))
  assert.equal(output.join(""), text)

  const count = output.length
  await stream.consume(final(input))
  assert.equal(stream.finish("tool-calls"), text)
  assert.equal(output.join(""), text)
  assert.equal(output.length, count)
})

test("complete characters publish immediately and the final call supplies a missing suffix once", async () => {
  const output: string[] = []
  const stream = new GroupReplyStream((piece) => output.push(piece))
  await stream.consume(start)
  await stream.consume(delta('{"text":"第一段\\'))
  assert.deepEqual(output, ["第一段"])
  await stream.consume(delta("n\\u4"))
  assert.deepEqual(output, ["第一段", "\n"])
  await stream.consume(delta("e2d\\uD83D"))
  await stream.consume(delta("\\uDD"))
  assert.deepEqual(output, ["第一段", "\n", "中"])

  const text = "第一段\n中🔬第二段"
  await stream.consume(final(JSON.stringify({ text })))
  assert.equal(stream.finish("stop"), text)
  assert.deepEqual(output, ["第一段", "\n", "中", "🔬第二段"])
  assert.equal(output.join(""), text)
})

test("the terminal arguments must validate and agree with already published text", async () => {
  const output: string[] = []
  const stream = new GroupReplyStream((piece) => output.push(piece))
  await stream.consume(start)
  await stream.consume(delta('{"text":"already public'))
  assert.throws(() => stream.finish("stop"), /did not finish/)
  await stream.consume(final('{"text":"different"}'))
  assert.throws(() => stream.finish("length"), /did not finish/)
  assert.throws(() => stream.finish("stop"), /changed previously emitted/)
  assert.deepEqual(output, ["already public"])

  const unexpected = new GroupReplyStream(() =>
    assert.fail("Published a nested field")
  )
  await unexpected.consume(start)
  const wrongShape = '{"unknown":{"text":"nested"}}'
  await unexpected.consume(delta(wrongShape))
  await assert.rejects(unexpected.consume(final(wrongShape)))
})
