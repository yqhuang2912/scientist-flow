import assert from "node:assert/strict"
import { test } from "node:test"
import { deepAgentReply } from "../lib/deepagents-reply.server"
import { gatewayStep } from "../lib/gateway-step.server"

test("the agent issues one authorized text request and publishes only completed public text", async (t) => {
  for (const variant of [
    "reply",
    "empty",
    "interrupted",
    "denied",
    "cancelled",
  ] as const) {
    await t.test(variant, async () => {
      const stop = new AbortController()
      let requests = 0
      let request!: {
        model: string
        reasoning: { effort: string }
        tools?: unknown[]
        messages: { content: unknown }[]
      }
      let authorization: string | null = null
      const route = gatewayStep(
        {
          modelId: "fixture/direct",
          effort: "low",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "target",
          authorize: async () => {},
          record: async () => "attempt",
          response: async () => {},
        },
        async (_url, init) => {
          requests++
          request = JSON.parse(String(init?.body))
          authorization = new Headers(init?.headers).get("authorization")
          if (variant === "denied") return new Response(null, { status: 401 })
          if (variant === "cancelled") {
            stop.abort()
            throw stop.signal.reason
          }
          const event = (delta: object, finish_reason: string | null = null) =>
            "data: " +
            JSON.stringify({
              object: "chat.completion.chunk",
              created: 1,
              id: "resp",
              model: request.model,
              choices: [{ index: 0, delta, finish_reason }],
            }) +
            "\n\n"
          return new Response(
            event({ reasoning: "private" }) +
              event({ content: variant === "empty" ? " " : "75" }) +
              (variant === "interrupted" ? "" : event({}, "stop")) +
              "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } }
          )
        }
      )
      const metadata = { executionId: "execution" }
      const stream = deepAgentReply({
        route,
        signal: stop.signal,
        metadata,
        messageId: "reply",
        instructions: "Bot identity",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "private" },
              { type: "text", text: "Prior public reply" },
            ],
          },
          { role: "user", content: "Question" },
        ],
        onError(error) {
          return error instanceof Error ? error.message : "failed"
        },
      })
      const chunks = []
      const reader = stream.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      assert.equal(authorization, "Bearer target")
      assert.equal(request.model, "fixture/direct")
      assert.equal(request.reasoning.effort, "low")
      assert.equal(request.tools?.length ?? 0, 0)
      assert.deepEqual(
        request.messages.map((m: { content: unknown }) => m.content),
        [
          [{ type: "text", text: "Bot identity" }],
          "Prior public reply",
          "Question",
        ]
      )
      assert.equal(requests, 1, JSON.stringify(chunks))
      assert.deepEqual(chunks[0], {
        type: "start",
        messageId: "reply",
        messageMetadata: { executionId: "execution", engine: "deepagents" },
      })
      assert.ok(!JSON.stringify(chunks).includes("private"))
      if (variant === "reply") {
        assert.deepEqual(
          chunks.filter((c) => c.type === "error"),
          []
        )
        assert.equal(
          chunks
            .filter((c) => c.type === "text-delta")
            .map((c) => c.delta)
            .join(""),
          "75"
        )
      } else if (variant === "cancelled")
        assert.ok(chunks.some((c) => c.type === "abort"))
      else
        assert.ok(
          chunks.some((c) => c.type === "error"),
          JSON.stringify(chunks)
        )
    })
  }
})
