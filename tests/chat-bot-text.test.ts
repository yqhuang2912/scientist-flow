import assert from "node:assert/strict"
import { test } from "node:test"
import {
  simulateReadableStream,
  convertToModelMessages,
  streamText,
  type TextStreamPart,
  type ToolSet,
} from "ai"
import { MockLanguageModelV3 } from "ai/test"
import { cleanBotText, botTextTransform } from "../lib/chat-bot-text"
import {
  prepareBotModelHistory,
  botInstructions,
} from "../lib/chat-bot-context"

const bots = [
  { name: "Coll", job: "Writing editor" },
  { name: "James", job: "Tutor" },
  { name: "Paul", job: "Research assistant" },
]
const marker = '[Historical assistant speaker: "James" ("Tutor")]'
const wrapper = '[James ("Tutor"): '

test("cleans the reported unclosed wrappers and repeated historical speaker labels", () => {
  for (const bot of bots) {
    const label = `[Historical assistant speaker: ${JSON.stringify(bot.name)} (${JSON.stringify(bot.job)})]`
    const body = "你好\n\n- First\n- Second"
    assert.equal(
      cleanBotText(
        `${label}\n${label}\n[${bot.name} (${JSON.stringify(bot.job)}): ${body}`,
        bots
      ),
      body
    )
  }
  assert.equal(cleanBotText(`${marker}\n${wrapper}Hello]`, bots), "Hello")
})

test("ordinary Markdown, code, brackets and references are preserved", () => {
  for (const body of [
    "[docs](https://example.com)",
    "[Note] hello",
    "```text\n" + marker + "\n```",
    "This quotes " + marker,
    "[1]",
    "",
    " ",
    "  Hello\n",
  ]) {
    assert.equal(cleanBotText(body, bots), body)
  }
  assert.equal(
    cleanBotText(wrapper + "Read [docs](https://example.com) and [1]", bots),
    "Read [docs](https://example.com) and [1]"
  )
})

async function transform(chunks: TextStreamPart<ToolSet>[]) {
  const stream = new ReadableStream<TextStreamPart<ToolSet>>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c))
      controller.close()
    },
  }).pipeThrough(botTextTransform(bots)({ tools: {}, stopStream() {} }))
  const result: TextStreamPart<ToolSet>[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    result.push(value)
  }
  return result
}
const text = (chunks: TextStreamPart<ToolSet>[]) =>
  chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => c.text)
    .join("")

test("split prefixes never reach a streamed text delta; text boundaries and metadata survive", async () => {
  const raw = marker + "\n" + wrapper + "Hello [1]]"
  for (let split = 1; split < raw.length; split++) {
    const chunks: TextStreamPart<ToolSet>[] = [
      { type: "text-start", id: "a" },
      { type: "text-delta", id: "a", text: raw.slice(0, split) },
      { type: "text-delta", id: "a", text: raw.slice(split) },
      { type: "text-end", id: "a" },
    ]
    const result = await transform(chunks)
    assert.equal(text(result), "Hello [1]", `split ${split}`)
    assert.equal(result[0], chunks[0])
    assert.equal(result.at(-1), chunks.at(-1))
    for (const chunk of result)
      if (chunk.type === "text-delta")
        assert.ok("Hello [1]".includes(chunk.text))
  }
})

test("one-character chunks, multiple text parts and bracketed lines preserve text", async () => {
  const first = marker + "\n" + wrapper + "Hello [1]\nnext [2]"
  const second = "[docs](https://example.com)"
  const chunks = [first, second].flatMap(
    (raw, i): TextStreamPart<ToolSet>[] => [
      { type: "text-start", id: String(i) },
      ...[...raw].map((text) => ({
        type: "text-delta" as const,
        id: String(i),
        text,
      })),
      { type: "text-end", id: String(i) },
    ]
  )
  assert.equal(text(await transform(chunks)), "Hello [1]\nnext [2]" + second)
})

test("AI SDK response text and persisted UI response contain only cleaned text", async () => {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t" },
          ...[...(marker + "\n" + wrapper + "Hello")].map((delta) => ({
            type: "text-delta" as const,
            id: "t",
            delta,
          })),
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  })
  const members = bots.map((bot) => ({
    ...bot,
    id: bot.name,
    instructions: null,
  }))
  const result = streamText({
    model,
    system: botInstructions(members[1], { kind: "group", bots: members }),
    allowSystemInMessages: true,
    messages: await convertToModelMessages(
      prepareBotModelHistory(
        [
          {
            id: "old",
            role: "assistant",
            metadata: { botId: "James" },
            parts: [
              {
                type: "text",
                text: marker + "\n" + wrapper + "Previous reply",
              },
            ],
          },
          {
            id: "new",
            role: "user",
            metadata: { botId: "James" },
            parts: [{ type: "text", text: "hi" }],
          },
        ],
        members
      )
    ),
    experimental_transform: botTextTransform(bots),
  })
  let persisted = ""
  const ui = result.toUIMessageStream({
    onFinish: ({ responseMessage }) => {
      persisted = responseMessage.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("")
    },
  })
  const visible: string[] = []
  for await (const chunk of ui)
    if (chunk.type === "text-delta") visible.push(chunk.delta)
  assert.equal(visible.join(""), "Hello")
  assert.equal(persisted, "Hello")
  assert.equal(await result.text, "Hello")
})
