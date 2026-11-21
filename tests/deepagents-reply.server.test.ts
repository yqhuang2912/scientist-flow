import assert from "node:assert/strict"
import { test } from "node:test"
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { simulateReadableStream, tool } from "ai"
import { z } from "zod"
import { MockLanguageModelV4 } from "ai/test"
import { deepAgentReply } from "../lib/deepagents-reply.server"
import { gatewayStep } from "../lib/gateway-step.server"
import { groupReplyOutput } from "../lib/group-reply-stream"
import { projectRecallTool } from "../lib/project-decisions"

test("ordinary group turns stream a committed reply and quarantine candidates until citation verification", async (t) => {
  for (const scenario of [
    "ordinary",
    "local",
    "conflicting-summary",
    "quoted",
    "foreign",
    "withdrawn",
    "mixed",
    "incomplete",
  ] as const) {
    await t.test(scenario, { timeout: 10_000 }, async () => {
      const record = "D-1234567890abcdef"
      const stored = {
        id: record,
        decision:
          scenario === "conflicting-summary"
            ? "本轮实验采用阈值 0.99"
            : "本轮实验采用阈值 0.42",
        toolEvidence: {
          executionId: "execution",
          toolCallId: "measurement",
          toolId: "tool",
          toolName: "read_threshold",
          digest: "digest",
          fields: [
            { path: "/threshold", value: 0.42 },
            { path: "/unit", value: "mV" },
            { path: "/period", value: "2026-10-01 至 2026-10-31" },
          ],
        },
        quote: "Original report\nwith a second line.",
      }
      const validCitation = ["local", "conflicting-summary", "quoted"].includes(
        scenario
      )
      const usesLookup =
        validCitation || scenario === "foreign" || scenario === "withdrawn"
      let active = true
      const verify = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const first = Promise.withResolvers<void>()
      const ready =
        Promise.withResolvers<
          ReadableStreamDefaultController<LanguageModelV4StreamPart>
        >()
      const outputs: string[] = [],
        citations: string[] = [],
        errors: string[] = []
      let lookups = 0
      const model = new MockLanguageModelV4({
        doStream: async ({ tools }) => {
          const recall = tools?.find((tool) => tool.name === projectRecallTool)
          assert.ok(recall?.type === "function")
          assert.deepEqual(Object.keys(recall.inputSchema.properties ?? {}), [
            "recordId",
          ])
          assert.ok(tools?.some((tool) => tool.name === groupReplyOutput.name))
          return {
            stream: new ReadableStream({ start: (c) => ready.resolve(c) }),
          }
        },
      })
      const stream = deepAgentReply({
        route: { model, providerOptions: {} },
        general: true,
        instructions: "Answer the group.",
        messages: [{ role: "user", content: "Question" }],
        messageId: "reply",
        metadata: { executionId: "run" },
        signal: new AbortController().signal,
        onError: () => "Rejected",
        resolveCitation: async (id) => {
          lookups++
          verify.resolve()
          await release.promise
          if (!active || id !== record) return
          return scenario === "quoted"
            ? { ...stored, decision: "Recorded decision", toolEvidence: null }
            : stored
        },
      }).getReader()
      const done = (async () => {
        for (;;) {
          const { value, done } = await stream.read()
          if (done) return
          assert.doesNotMatch(JSON.stringify(value), /未核对的候选文字|0\.99/)
          if (value.type === "text-delta") {
            outputs.push(value.delta)
            first.resolve()
          }
          if (value.type === "source-document") citations.push(value.sourceId)
          if (value.type === "error") errors.push(value.errorText)
        }
      })()
      const c = await ready.promise
      c.enqueue({
        type: "text-delta",
        id: "candidate",
        delta: "未核对的候选文字",
      })
      if (scenario === "ordinary" || scenario === "mixed") {
        c.enqueue({
          type: "tool-input-start",
          id: "body",
          toolName: groupReplyOutput.name,
        })
        c.enqueue({
          type: "tool-input-delta",
          id: "body",
          delta: '{"text":"第一段',
        })
        await first.promise
        assert.deepEqual(outputs, ["第一段"])
        if (scenario === "ordinary") {
          c.enqueue({ type: "tool-input-delta", id: "body", delta: '第二段"}' })
          c.enqueue({
            type: "tool-call",
            toolName: groupReplyOutput.name,
            toolCallId: "body",
            input: '{"text":"第一段第二段"}',
          })
        }
      }
      if (scenario === "incomplete")
        c.enqueue({
          type: "tool-input-start",
          id: "lookup",
          toolName: projectRecallTool,
        })
      else if (scenario !== "ordinary")
        c.enqueue({
          type: "tool-call",
          toolName: projectRecallTool,
          toolCallId: "lookup",
          input: JSON.stringify({
            recordId: scenario === "foreign" ? "D-0000000000000000" : record,
            ...(scenario !== "quoted" && { answer: "阈值为 0.99" }),
          }),
        })
      c.enqueue({
        type: "finish",
        finishReason:
          scenario === "incomplete"
            ? { unified: "stop", raw: "stop" }
            : { unified: "tool-calls", raw: "tool_calls" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      })
      c.close()
      if (usesLookup) {
        await verify.promise
        assert.deepEqual(outputs, [])
        assert.deepEqual(citations, [])
        if (scenario === "withdrawn") active = false
        release.resolve()
      }
      await done
      assert.equal(model.doStreamCalls.length, 1)
      assert.deepEqual(citations, validCitation ? [record] : [])
      assert.deepEqual(
        errors,
        scenario === "mixed" || scenario === "incomplete" ? ["Rejected"] : []
      )
      assert.equal(lookups, usesLookup ? 1 : 0)
      if (usesLookup) assert.equal(outputs.length, 1)
      const observation =
        "阈值为 0.42 · 单位为 mV · 报告期为 2026-10-01 至 2026-10-31"
      assert.equal(
        outputs.join(""),
        {
          ordinary: "第一段第二段",
          local: observation,
          "conflicting-summary": observation,
          quoted:
            "Recorded decision\n\n> Original report\n> with a second line.",
          mixed: "第一段",
          incomplete: "",
          foreign: "No matching active decision was found in this project.",
          withdrawn: "No matching active decision was found in this project.",
        }[scenario]
      )
    })
  }
})

test("only one complete, validated handoff reaches the dispatcher", async (t) => {
  const call = {
    type: "tool-call" as const,
    toolName: "handoff",
    toolCallId: "call-1",
    input: JSON.stringify({
      botName: "Rowan",
      reason: "Check the arithmetic.",
    }),
  }
  const finish: LanguageModelV4StreamPart = {
    type: "finish",
    finishReason: { unified: "tool-calls", raw: "tool_calls" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  }
  const cases: [string, LanguageModelV4StreamPart[], number][] = [
    ["duplicate event", [call, call, finish], 1],
    ["multiple calls", [call, { ...call, toolCallId: "call-2" }, finish], 0],
    ["incomplete stream", [call], 0],
    ["invalid JSON", [{ ...call, input: "{" }, finish], 0],
    ["missing task", [{ ...call, input: '{"botName":"Rowan"}' }, finish], 0],
    ["unknown tool", [{ ...call, toolName: "other" }, finish], 0],
  ]
  for (const [name, chunks, expected] of cases) {
    await t.test(name, async () => {
      let calls = 0
      const model = new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({ chunks }),
        }),
      })
      const reader = deepAgentReply({
        route: { model, providerOptions: { openai: {} } },
        instructions: "Delegate to Rowan.",
        messages: [{ role: "user", content: "Check the arithmetic." }],
        messageId: "sender",
        metadata: { executionId: "root" },
        signal: new AbortController().signal,
        handoff: async () => {
          calls++
          return { success: true }
        },
        onError: () => "Rejected",
      }).getReader()
      const output = []
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        output.push(next.value)
      }
      assert.equal(calls, expected)
      assert.equal(
        output.filter((c) => c.type === "tool-output-available").length,
        expected
      )
      assert.equal(
        output.some((c) => c.type === "error"),
        expected === 0
      )
    })
  }
})

test("recipient accepts sequential calls only and deduplicates dispatch within one invocation", async (t) => {
  const call = (toolName: string, toolCallId: string) => ({
    type: "tool-call" as const,
    toolName,
    toolCallId,
    input: "{}",
  })
  const read = call("read_skill", "read"),
    http = call("lookup", "fetch")
  const cases = [
    {
      name: "sequential duplicate stream events",
      batches: [[read, read], [http, http], []],
      executed: ["read", "fetch"],
    },
    { name: "parallel read and lookup", batches: [[read, http]], executed: [] },
    {
      name: "lookup reuses the skill call ID",
      batches: [[read], [call("lookup", "read")]],
      executed: ["read"],
    },
    {
      name: "extra lookup at the final step",
      batches: [[read], [http], [call("lookup", "again")]],
      executed: ["read", "fetch"],
    },
  ]
  for (const { name, batches, executed } of cases)
    await t.test(name, async () => {
      const seen: string[] = []
      let step = 0
      const model = new MockLanguageModelV4({
        doStream: async () => {
          const batch = batches[step++]
          assert.ok(batch)
          const chunks: LanguageModelV4StreamPart[] = batch.length
            ? [...batch]
            : [
                { type: "text-start", id: "answer" },
                { type: "text-delta", id: "answer", delta: "Done" },
                { type: "text-end", id: "answer" },
              ]
          chunks.push({
            type: "finish",
            finishReason: {
              unified: batch.length ? "tool-calls" : "stop",
              raw: undefined,
            },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          })
          return { stream: simulateReadableStream({ chunks }) }
        },
      })
      const shared = tool({
        inputSchema: z.object({}),
        execute: async (_, { toolCallId }) => {
          seen.push(toolCallId)
          return { success: true }
        },
        toModelOutput: () => ({ type: "text", value: "Tool result" }),
      })
      const route = { model, providerOptions: { openai: {} } }
      const reader = deepAgentReply({
        route,
        recipient: {
          botId: "recipient",
          tools: { read_skill: shared, lookup: shared },
          followup: () => route,
        },
        instructions: "Answer the task.",
        messages: [{ role: "user", content: "Question" }],
        messageId: "one",
        metadata: { executionId: "one-run" },
        signal: new AbortController().signal,
        onError: () => "Rejected",
      }).getReader()
      const chunks = []
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        chunks.push(next.value)
      }
      assert.deepEqual(seen, executed)
      assert.equal(
        chunks.some((c) => c.type === "error"),
        batches.at(-1)!.length > 0
      )
    })
})

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
