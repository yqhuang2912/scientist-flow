import test from "node:test"
import assert from "node:assert/strict"
import { Readable } from "node:stream"
import { executeSharedHttpTool } from "../lib/shared-http-executor"
import { publicAddress, type ToolRequest } from "../lib/public-https"
import {
  httpToolTurn,
  historyHttpTools,
  redactToolInputs,
} from "../lib/bot-http-tools"
import { convertToModelMessages, type ToolSet, type TextStreamPart } from "ai"
import { botFormSchema, type ToolDefinition } from "../db/schema"

const schema = {
  type: "object" as const,
  properties: {
    count: { type: "integer" as const },
    enabled: { type: "boolean" as const },
    label: { type: "string" as const },
  },
  additionalProperties: false,
}
const definition = {
  kind: "http" as const,
  name: "count_items",
  description: "Count items",
  displayName: "Item count",
  config: {
    method: "GET" as const,
    url: "https://example.com/items",
    auth: { type: "none" as const },
  },
  inputSchema: schema,
}
const ok = () => ({
  status: 200,
  contentType: "application/json",
  body: Readable.from(['{"count":3}']),
})

test("finishing a skill read after an HTTP call starts cannot qualify it as evidence", async () => {
  const scope = {
    chatId: "group",
    botId: "recipient",
    executionId: "run",
    messageId: "reply",
  }
  const bound = {
    ...definition,
    id: "lookup",
    createdAt: new Date(),
    updatedAt: new Date(),
    botId: scope.botId,
    botName: "Recipient",
  }
  let read = false
  const turn = httpToolTurn(
    [bound],
    async () => bound,
    async () => true,
    async () => {
      read = true
      return ok()
    },
    () => (read ? scope : undefined)
  )
  const lookup = turn.tools.count_items
  const call = async (toolCallId: string) => {
    const output = await lookup.execute!(
      {},
      { toolCallId, messages: [], context: scope }
    )
    assert.ok(output.success)
    const result = await lookup.toModelOutput!({
      input: {},
      toolCallId,
      output,
    })
    assert.equal(result.type, "text")
    return JSON.parse(result.value)
  }
  assert.deepEqual(await call("early"), { count: 3 })
  const later = await call("later")
  assert.equal(turn.observation(later.evidenceRef)?.toolCallId, "later")
})

test("Bot forms distinguish absent tool IDs from clearing and deduplicate selected tool IDs", () => {
  const base = {
      modelChoice: {
        connectionId: "a".repeat(21),
        modelId: "fixture",
        effort: null,
      },
      name: "A",
      job: "B",
      avatar: "C",
      skillIds: [],
    },
    id = "a".repeat(21)
  assert.equal(botFormSchema.safeParse(base).success, false)
  assert.equal(
    botFormSchema.safeParse({ ...base, toolIds: ["missing"] }).success,
    false
  )
  assert.deepEqual(botFormSchema.parse({ ...base, toolIds: [] }).toolIds, [])
  assert.deepEqual(
    botFormSchema.parse({ ...base, toolIds: [id, id] }).toolIds,
    [id]
  )
})

test("public routing excludes special-use addresses and allows global unicast", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.8",
    "169.254.169.254",
    "168.63.129.16",
    "198.18.0.4",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::2",
    "2002::1",
    "2001:db8::4",
  ])
    assert.equal(publicAddress(ip), false, ip)
  for (const ip of ["1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(publicAddress(ip), true, ip)
})

test("validates before transport, encodes scalar GETs exactly and sends a nested JSON POST", async () => {
  const sent: ToolRequest[] = []
  const send = async (r: ToolRequest) => {
    sent.push(r)
    return ok()
  }
  for (const input of [{ count: "1" }, { url: "https://other.invalid" }, []])
    assert.equal(
      (await executeSharedHttpTool(definition, input, undefined, send)).success,
      false
    )
  assert.equal(sent.length, 0)
  assert.ok(
    (
      await executeSharedHttpTool(
        definition,
        { count: 0, enabled: false, label: "" },
        undefined,
        send
      )
    ).success
  )
  assert.deepEqual(Object.fromEntries(sent[0].url.searchParams), {
    count: "0",
    enabled: "false",
    label: "",
  })
  assert.equal(sent[0].body, undefined)
  const post = {
    ...definition,
    config: { ...definition.config, method: "POST" },
    inputSchema: {
      type: "object",
      properties: { items: { type: "array", items: { type: "integer" } } },
    },
  }
  const input = { items: [0, 2] }
  assert.ok((await executeSharedHttpTool(post, input, undefined, send)).success)
  assert.deepEqual(JSON.parse(sent[1].body!), input)
  assert.equal(sent[1].headers["content-type"], "application/json")
})

test("bearer origin, cancellation, status, media type and streamed byte limits", async (t) => {
  const key = "TOOL_HTTP_TEST",
    auth = { type: "bearer_env", envVar: key }
  const def = { ...definition, config: { ...definition.config, auth } }
  const old = process.env
  process.env = {
    ...old,
    [key]: "private-fixture",
    SCIENTISTFLOW_TOOL_BEARER_ORIGINS:
      '{"TOOL_HTTP_TEST":"https://other.invalid"}',
  }
  t.after(() => {
    process.env = old
  })
  let calls = 0
  const send = async (r: ToolRequest) => {
    calls++
    assert.equal(r.headers.authorization, "Bearer private-fixture")
    return ok()
  }
  assert.equal(
    (await executeSharedHttpTool(def, {}, undefined, send)).success,
    false
  )
  assert.equal(calls, 0)
  process.env.SCIENTISTFLOW_TOOL_BEARER_ORIGINS =
    '{"TOOL_HTTP_TEST":"https://example.com"}'
  assert.ok((await executeSharedHttpTool(def, {}, undefined, send)).success)
  assert.equal(
    (await executeSharedHttpTool(def, {}, AbortSignal.abort(), send)).success,
    false
  )
  assert.equal(calls, 1)
  for (const response of [
    { ...ok(), status: 302 },
    { ...ok(), status: 503 },
    { ...ok(), contentType: "text/html" },
    { ...ok(), body: Readable.from(["x".repeat(33000), "x".repeat(33000)]) },
    { ...ok(), body: Readable.from(['"private-fixture"']) },
  ]) {
    const result = await executeSharedHttpTool(
      def,
      {},
      undefined,
      async () => response
    )
    assert.equal(result.success, false)
    assert.equal(result.status, response.status)
  }
})

test("a legacy HTTP definition keeps its own execution scope when its name becomes reserved", async () => {
  const bound = {
    ...definition,
    name: "record_project_decision",
    id: "old-tool",
    createdAt: new Date(),
    updatedAt: new Date(),
    botId: "owner",
    botName: "Owner",
  }
  const turn = httpToolTurn(
    [bound],
    async () => bound,
    async () => true,
    async () => ok()
  )
  const [alias] = turn.names("owner")
  assert.equal(alias, "shared-http-record_project_decision")
  assert.deepEqual(Object.keys(historyHttpTools([bound])), [alias])
  assert.equal(turn.tools.record_project_decision, undefined)
  const call = await turn.tools[alias].execute!(
    { count: 1 },
    { toolCallId: "legacy", messages: [], context: { botId: "owner" } }
  )
  assert.deepEqual((call as { success: boolean }).success, true)
  assert.equal((call as { name: string }).name, bound.name)
})

test("turn scopes execution, rechecks membership and only receipts survive replay", async () => {
  const bound = {
    ...definition,
    id: "tool-a",
    createdAt: new Date(),
    updatedAt: new Date(),
    botId: "receiver",
    botName: "Receiver",
  } satisfies ToolDefinition & { botId: string; botName: string }
  let current = true,
    requests = 0
  const turn = httpToolTurn(
    [bound],
    async () => (current ? bound : undefined),
    async () => true,
    async () => {
      requests++
      return ok()
    }
  )
  assert.deepEqual(turn.names("source"), [])
  assert.deepEqual(turn.names("receiver"), ["count_items"])
  const run = async (botId: string, call: string) =>
    await turn.tools.count_items.execute!(
      { count: 1 },
      { toolCallId: call, messages: [], context: { botId } }
    )
  assert.equal((await run("source", "wrong")).success, false)
  const receipt = await run("receiver", "right")
  assert.equal(receipt.success, true)
  assert.equal(receipt.status, 200)
  assert.equal(receipt.botId, "receiver")
  assert.ok(!("data" in receipt))
  current = false
  assert.equal((await run("receiver", "unbound")).success, false)
  const history = await convertToModelMessages(
    [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-count_items",
            toolCallId: "right",
            state: "output-available",
            input: {},
            output: receipt,
          },
        ],
      },
    ],
    { tools: historyHttpTools([bound]) }
  )
  assert.match(JSON.stringify(history), /Historical HTTP call/)
  assert.equal(requests, 1)
  const output = await turn.tools.count_items.toModelOutput!({
    input: {},
    toolCallId: "right",
    output: receipt,
  })
  assert.match(JSON.stringify(output), /count/)
})

test("outgoing tool stream masks partial and complete arguments", async () => {
  const chunks: TextStreamPart<ToolSet>[] = [
    { type: "tool-input-start", id: "c", toolName: "count_items" },
    { type: "tool-input-delta", id: "c", delta: "sensitive fixture" },
    {
      type: "tool-call",
      toolName: "count_items",
      toolCallId: "c",
      input: { label: "sensitive fixture" },
    },
    { type: "tool-input-end", id: "c" },
  ]
  const transform = redactToolInputs<ToolSet>(new Set(["count_items"]))({
    tools: {},
    stopStream() {},
  })
  const result: TextStreamPart<ToolSet>[] = []
  const source = new ReadableStream<TextStreamPart<ToolSet>>({
    start(c) {
      for (const part of chunks) c.enqueue(part)
      c.close()
    },
  })
  await source.pipeThrough(transform).pipeTo(
    new WritableStream({
      write(part) {
        result.push(part)
      },
    })
  )
  assert.doesNotMatch(JSON.stringify(result), /sensitive fixture/)
})
test("a repeated POST does not reach the transport twice, even in a reconstructed turn", async () => {
  const bound = {
    ...definition,
    config: { ...definition.config, method: "POST" as const },
    id: "p",
    createdAt: new Date(),
    updatedAt: new Date(),
    botId: "b",
    botName: "B",
  }
  const claimed = new Set<string>()
  let sent = 0
  const invoke = (input: Record<string, unknown>, call: string) => {
    const fresh = httpToolTurn(
      [bound],
      async () => bound,
      async (_id, hash) => {
        if (claimed.has(hash)) return false
        claimed.add(hash)
        return true
      },
      async () => {
        sent++
        return ok()
      }
    )
    return fresh.tools.count_items.execute!(input, {
      toolCallId: call,
      messages: [],
      context: { botId: "b" },
    })
  }
  assert.ok((await invoke({ count: 1, label: "a" }, "c1")).success)
  assert.equal((await invoke({ label: "a", count: 1 }, "c2")).success, false)
  assert.equal(sent, 1)
})
test("a timeout after POST dispatch is ambiguous and causes no automatic retry", async () => {
  let calls = 0
  const result = await executeSharedHttpTool(
    { ...definition, config: { ...definition.config, method: "POST" } },
    {},
    AbortSignal.timeout(20),
    async (req) => {
      calls++
      return await new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(Error("test deadline")), 500)
        req.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer)
            reject(req.signal.reason)
          },
          { once: true }
        )
      })
    }
  )
  assert.equal(calls, 1)
  assert.ok(
    !result.success &&
      result.postOutcomeUnknown &&
      result.message.includes("timed out")
  )
})
