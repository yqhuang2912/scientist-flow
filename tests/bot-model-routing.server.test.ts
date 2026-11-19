import { strict as assert } from "node:assert"
import { test } from "node:test"
import { randomBytes } from "node:crypto"
import { streamText, type ModelMessage } from "ai"
import { accountCatalog, CatalogError } from "../lib/openrouter-catalog.server"
import {
  parseCatalog,
  choiceProblem,
  type ConnectionSummary,
  type Effort,
} from "../lib/model-catalog"
import { sealCredential, openCredential } from "../lib/model-credentials.server"
import {
  openRouterStep,
  portableHistory,
  type OutboundRecord,
} from "../lib/openrouter-step.server"

const modelId = "test/same:free"
const modelData = {
  id: modelId,
  name: "Shared model",
  supported_parameters: ["tools", "reasoning"],
  reasoning: { supported_efforts: ["high", "vendor-level"] },
}
const catalogs = new Map([
  ["fixture-key-a", [modelData]],
  ["fixture-key-b", [{ ...modelData, reasoning: { supported_efforts: [] } }]],
])
test("each account authenticates its own user catalog; a matching model ID does not share efforts", async () => {
  const calls: string[] = []
  const transport: typeof fetch = async (url, init) => {
    const key = new Headers(init?.headers).get("authorization")?.slice(7) ?? ""
    assert.ok(catalogs.has(key))
    const path = new URL(String(url)).pathname
    calls.push(key + path)
    return Response.json({
      data: path.endsWith("/key") ? { is_free_tier: true } : catalogs.get(key),
    })
  }
  const [a, b] = await Promise.all(
    [...catalogs.keys()].map((key) => accountCatalog(key, transport))
  )
  assert.equal(calls.length, 4)
  for (const key of catalogs.keys())
    assert.deepEqual(
      calls.filter((s) => s.startsWith(key)),
      [key + "/api/v1/key", key + "/api/v1/models/user"]
    )
  assert.equal(a[0].id, b[0].id)
  assert.deepEqual(a[0].efforts, ["high"])
  assert.deepEqual(b[0].efforts, [])
  const connection: ConnectionSummary = {
    id: "a",
    nickname: "Example",
    revision: "r1",
    state: "ready",
    catalog: a,
  }
  const choice = { connectionId: "a", modelId, effort: "high" as const }
  assert.equal(choiceProblem(choice, connection), null)
  assert.match(
    choiceProblem(choice, { ...connection, id: "different-owner-connection" })!,
    /unavailable/
  )
  assert.match(choiceProblem(choice, { ...connection, catalog: b })!, /effort/)
  assert.match(
    choiceProblem(choice, { ...connection, catalog: [] })!,
    /no longer/
  )
  assert.match(
    choiceProblem(choice, { ...connection, state: "disconnected" })!,
    /Disconnected/
  )
  const unavailable = parseCatalog({
    data: [{ id: modelId, supported_parameters: [] }],
  })
  assert.match(
    choiceProblem(choice, { ...connection, catalog: unavailable })!,
    /Tool calls unsupported/
  )
})
test("invalid key, catalog outage and a valid empty catalog remain distinguishable", async () => {
  await assert.rejects(
    accountCatalog("dummy", async () => new Response(null, { status: 401 })),
    (e) => e instanceof CatalogError && e.state === "invalid"
  )
  await assert.rejects(
    accountCatalog("dummy", async (url) =>
      String(url).endsWith("/key")
        ? Response.json({ data: {} })
        : new Response(null, { status: 503 })
    ),
    (e) => e instanceof CatalogError && e.state === "catalog-error"
  )
  assert.deepEqual(
    await accountCatalog("dummy", async (url) =>
      Response.json({ data: String(url).endsWith("/key") ? {} : [] })
    ),
    []
  )
})
test("credentials are authenticated against both installation and connection", () => {
  const prior = process.env.SCIENTISTFLOW_MODEL_MASTER_KEY
  process.env.SCIENTISTFLOW_MODEL_MASTER_KEY =
    randomBytes(32).toString("base64")
  try {
    const ciphertext = sealCredential("local-owner", "a", "fixture-key-a")
    assert.notEqual(
      ciphertext,
      sealCredential("local-owner", "a", "fixture-key-a")
    )
    assert.equal(
      openCredential("local-owner", "a", ciphertext),
      "fixture-key-a"
    )
    assert.throws(
      () => openCredential("other-owner", "a", ciphertext),
      /unlock/
    )
    assert.throws(
      () => openCredential("local-owner", "b", ciphertext),
      /unlock/
    )
  } finally {
    if (prior === undefined) delete process.env.SCIENTISTFLOW_MODEL_MASTER_KEY
    else process.env.SCIENTISTFLOW_MODEL_MASTER_KEY = prior
  }
})

function completion(delta: object, finish: string) {
  const event = (change: object, finish_reason: string | null) =>
    "data: " +
    JSON.stringify({
      id: "gen-fixture",
      model: modelId,
      object: "chat.completion.chunk",
      created: 1,
      choices: [{ index: 0, delta: change, finish_reason }],
    }) +
    "\n\n"
  return new Response(
    event(delta, null) + event({}, finish) + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } }
  )
}
function fixture(
  key: string,
  effort: Effort | null,
  transport: typeof fetch,
  authorize = async () => {}
) {
  const audit: OutboundRecord[] = []
  const responses: unknown[] = []
  const route = openRouterStep(
    {
      modelId,
      apiKey: key,
      effort,
      authorize,
      record: async (record) => {
        audit.push(record)
        return String(audit.length)
      },
      response: async (_attempt, fields) => {
        responses.push(fields)
      },
    },
    transport
  )
  return { route, audit, responses }
}
test("concurrent streams with the same model ID use independent credentials, overrides and receipts", async () => {
  let count = 0
  let bothStarted!: () => void
  const rendezvous = new Promise<void>((resolve) => {
    bothStarted = resolve
  })
  const transport: typeof fetch = async (_url, init) => {
    const auth = new Headers(init?.headers).get("authorization")
    const body = JSON.parse(String(init?.body))
    if (auth === "Bearer fixture-key-a")
      assert.deepEqual(body.reasoning, { effort: "high" })
    else {
      assert.equal(auth, "Bearer fixture-key-b")
      assert.ok(!("reasoning" in body))
    }
    if (++count === 2) bothStarted()
    await rendezvous
    return completion({ content: "ok" }, "stop")
  }
  const a = fixture("fixture-key-a", "high", transport),
    b = fixture("fixture-key-b", null, transport)
  const texts = await Promise.all(
    [a, b].map(
      async ({ route }) =>
        streamText({ ...route, prompt: "hi", maxRetries: 0 }).text
    )
  )
  assert.deepEqual(texts, ["ok", "ok"])
  assert.deepEqual(a.audit, [
    { model: modelId, effort: "high", httpStatus: 200 },
  ])
  assert.deepEqual(b.audit, [{ model: modelId, effort: null, httpStatus: 200 }])
  // This adapter can emit the completion ID before it receives the model ID.
  for (const stream of [a, b])
    assert.deepEqual(stream.responses.at(-1), {
      responseId: "gen-fixture",
      responseModel: modelId,
    })
})
test("rotation between resolving and sending blocks the stale credential before transport", async () => {
  let revision = "first"
  let sent = 0
  const { route } = fixture(
    "obsolete",
    null,
    async () => {
      sent++
      return completion({ content: "ok" }, "stop")
    },
    async () => {
      assert.equal(revision, "first", "connection changed")
    }
  )
  revision = "second"
  const events = []
  for await (const event of streamText({
    ...route,
    prompt: "hi",
    maxRetries: 0,
    onError: () => {},
  }).fullStream)
    events.push(event.type)
  assert.ok(events.includes("error"))
  assert.equal(sent, 0)
})
test("portable history removes adapter metadata while preserving user tool data", () => {
  const privateOptions = { openrouter: { signature: "private" } }
  const messages: ModelMessage[] = [
    {
      role: "assistant",
      providerOptions: privateOptions,
      content: [
        { type: "reasoning", text: "private" },
        { type: "text", text: "hello", providerOptions: privateOptions },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call",
          toolName: "lookup",
          output: {
            type: "json",
            value: { providerOptions: "application data" },
            providerOptions: privateOptions,
          },
          providerOptions: privateOptions,
        },
      ],
    },
  ]
  const clean = portableHistory(messages)
  assert.ok(!JSON.stringify(clean).includes("private"))
  assert.ok(JSON.stringify(clean).includes("application data"))
  assert.ok(JSON.stringify(messages).includes("private"))
})
