import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import {
  GroupReplyStream,
  groupReplyOutput,
} from "../../lib/group-reply-stream"

// Run with: npx --no-install tsx tests/benchmarks/group-reply-stream.ts
const line = '# 研究记录 🔬\n- **观测**：读数 "0.42"；路径 C:\\data\\obs\n'
const samples = [8192, 16384, 32768].map((length) => {
  const text = line
    .repeat(Math.floor(length / line.length))
    .padEnd(length, "。")
  const input = JSON.stringify({ text })
  const id = "reply"
  const toolName = groupReplyOutput.name
  const deltas: LanguageModelV4StreamPart[] = []
  for (let pos = 0; pos < input.length; pos += 32) {
    deltas.push({
      type: "tool-input-delta",
      id,
      delta: input.slice(pos, pos + 32),
    })
  }
  const events: LanguageModelV4StreamPart[] = [
    { type: "tool-input-start", id, toolName },
    ...deltas,
    { type: "tool-call", toolCallId: id, toolName, input },
  ]
  return { text, events, chunks: deltas.length, times: [] as number[] }
})

for (let round = 0; round < 12; round++) {
  for (let i = 0; i < samples.length; i++) {
    const { text, events, times } = samples[(round + i) % samples.length]
    const output: string[] = []
    const stream = new GroupReplyStream((delta) => output.push(delta))
    const start = performance.now()
    for (const event of events) await stream.consume(event)
    const final = stream.finish("tool-calls")
    const elapsed = performance.now() - start
    assert.equal(output.join(""), text)
    assert.equal(final, text)
    if (round >= 3) times.push(elapsed)
  }
}

console.log(
  `Node ${process.version}, 32 UTF-16 units per delta, 3 warmups, 9 measured runs`
)
for (const { text, chunks, times } of samples) {
  times.sort((a, b) => a - b)
  console.log(
    `${text.length} units, ${chunks} deltas, median ${times[4].toFixed(3)} ms`
  )
}
