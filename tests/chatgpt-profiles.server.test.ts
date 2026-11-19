import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { streamText, tool } from "ai"
import { z } from "zod"
import { eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { SignJWT, generateKeyPair } from "jose"
import { chatCatalog } from "../lib/chatgpt-catalog.server"
import { chatGPTStep } from "../lib/chatgpt-step.server"
import {
  hostIdentifier,
  storeRegistration,
  withRegistration,
  type Registration,
} from "../lib/chatgpt-vault.server"
import {
  verifiedIdentity,
  accessForProfile,
  startAuthorization,
  signInStatus,
  planScope,
} from "../lib/chatgpt-oauth.server"

const modelId = "fixture-model"
function streamResponse(terminal = "response.completed") {
  const message = { type: "message", id: "msg_fixture" }
  const events = [
    {
      type: "response.created",
      response: { id: "resp_fixture", model: modelId, created_at: 1 },
    },
    { type: "response.output_item.added", output_index: 0, item: message },
    {
      type: "response.output_text.delta",
      item_id: message.id,
      output_index: 0,
      delta: "ok",
    },
    { type: "response.output_item.done", output_index: 0, item: message },
  ]
  const ending = {
    type: terminal,
    sequence_number: 5,
    response: {
      id: "resp_fixture",
      model: modelId,
      ...(terminal === "response.failed" && {
        error: {
          code: "subscription_sharing_usage_limit_exceeded",
          message: "plan limit",
        },
      }),
    },
  }
  return new Response(
    [...events, ...(terminal ? [ending] : [])]
      .map((e) => "data: " + JSON.stringify(e) + "\n\n")
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } }
  )
}
test("separate grants use their own visible model order, names and effort capabilities", async () => {
  const fetchModels: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/models")
    const a =
      new Headers(init?.headers).get("authorization") === "Bearer fixture-a"
    return Response.json({
      models: [
        {
          slug: "z",
          display_name: "First",
          visibility: "list",
          supported_reasoning_levels: (a ? ["ultra", "max"] : ["medium"]).map(
            (e) => ({ effort: e })
          ),
        },
        { visibility: "hidden" },
        { slug: "a", display_name: "Last", visibility: "list" },
      ],
    })
  }
  const [a, b] = await Promise.all(
    ["fixture-a", "fixture-b"].map((k) => chatCatalog(k, fetchModels))
  )
  assert.deepEqual(
    a.map((m) => m.id),
    ["z", "a"]
  )
  assert.deepEqual(a[0].efforts, ["ultra", "max"])
  assert.equal(b[0].fixedEffort, "medium")
  assert.equal(a[1].effortNote, "Levels unconfirmed")
})
test("interleaved same-model requests use the selected grant, serialize namespaced tool results, and isolate B's failure", async () => {
  let release!: () => void
  const both = new Promise<void>((r) => (release = r))
  let bInvalid = false
  const sent: string[] = []
  const transport: typeof fetch = async (url, init) => {
    const auth = new Headers(init?.headers).get("authorization")
    const alias =
      auth === "Bearer synthetic-A"
        ? "A"
        : auth === "Bearer synthetic-B"
          ? "B"
          : "unknown"
    assert.notEqual(alias, "unknown")
    assert.equal(String(url), "https://api.openai.com/v1/responses")
    const wire = JSON.parse(String(init?.body))
    assert.equal(wire.model, modelId)
    assert.equal(wire.reasoning.effort, alias === "A" ? "low" : "ultra")
    assert.equal(wire.store, false)
    assert.equal(wire.stream, true)
    assert.ok(wire.input.some((v: { role?: string }) => v.role === "developer"))
    assert.deepEqual(
      wire.tools.map((v: { type: string; name: string }) => [v.type, v.name]),
      [["namespace", "scientistflow"]]
    )
    const call = wire.input.find(
      (v: { type?: string }) => v.type === "function_call"
    )
    const output = wire.input.find(
      (v: { type?: string }) => v.type === "function_call_output"
    )
    assert.equal(call.namespace, "scientistflow")
    assert.equal(call.call_id, output.call_id)
    sent.push(alias)
    if (sent.length === 2) release()
    await both
    return alias === "B" && bInvalid
      ? Response.json({ error: { code: "invalid_token" } }, { status: 401 })
      : streamResponse()
  }
  const blocked: string[] = [],
    outcomes: string[] = []
  const invoke = async (alias: "A" | "B") => {
    const route = chatGPTStep(
      {
        modelId,
        effort: alias === "A" ? "low" : "ultra",
        token: async () => "synthetic-" + alias,
        authorize: async () => {},
        record: async () => alias,
        receipt: async (id, r) => {
          outcomes.push(id + ":" + r.outcome)
        },
        block: async (e) => {
          blocked.push(alias + ":" + e.state)
        },
      },
      transport
    )
    const r = streamText({
      ...route,
      maxRetries: 0,
      onError: () => {},
      system: "Test developer instructions",
      tools: { handoff: tool({ inputSchema: z.object({}) }) },
      messages: [
        { role: "user", content: "Delegate" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "handoff",
              toolCallId: "call_fixture",
              input: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolName: "handoff",
              toolCallId: "call_fixture",
              output: { type: "text", value: "accepted" },
            },
          ],
        },
      ],
    })
    const parts = []
    for await (const p of r.fullStream) parts.push(p.type)
    return parts
  }
  const results = await Promise.all([invoke("A"), invoke("B")])
  assert.ok(results.every((parts) => parts.includes("text-delta")))
  assert.deepEqual(outcomes.slice().sort(), ["A:completed", "B:completed"])
  bInvalid = true
  assert.ok((await invoke("B")).includes("error"))
  assert.equal(sent.filter((s) => s === "A").length, 1)
  assert.deepEqual(blocked, ["B:invalid"])
  assert.ok((await invoke("A")).includes("text-delta"))
  assert.deepEqual(outcomes.slice(-2), ["B:failed", "A:completed"])
})
test("HTTP 200 without response.completed never succeeds", async () => {
  for (const [event, outcome, expectedBlock] of [
    ["response.failed", "failed", "limited"],
    ["response.incomplete", "incomplete", ""],
    ["", "interrupted", ""],
  ]) {
    const outcomes: string[] = [],
      blocked: string[] = []
    const route = chatGPTStep(
      {
        modelId,
        effort: null,
        token: async () => "synthetic",
        authorize: async () => {},
        record: async () => "audit",
        receipt: async (_, v) => {
          outcomes.push(v.outcome)
        },
        block: async (e) => {
          blocked.push(e.state)
        },
      },
      async () => streamResponse(event)
    )
    const parts = []
    for await (const p of streamText({
      ...route,
      prompt: "hi",
      maxRetries: 0,
      onError: () => {},
    }).fullStream)
      parts.push(p.type)
    assert.ok(parts.includes("error"))
    assert.deepEqual(outcomes, [outcome])
    assert.equal(blocked.join(), expectedBlock)
  }
})
const registration: Registration = {
  clientId: "oaiapp_fixture",
  subject: "synthetic-subject",
  tokens: {
    access: "expired",
    refresh: "first",
    id: "synthetic",
    expiresAt: 0,
    scopes: [planScope],
  },
}
async function isolatedInstallation(t: TestContext) {
  const folder = await mkdtemp(path.join(tmpdir(), "sf-profile-test-"))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const vars = {
    SCIENTISTFLOW_PROFILE_DIR: folder,
    SCIENTISTFLOW_INSTALLATION_ID: "fixture-" + randomUUID(),
    SCIENTISTFLOW_MODEL_MASTER_KEY: randomBytes(32).toString("base64"),
  }
  for (const [k, v] of Object.entries(vars)) {
    const previous = process.env[k]
    process.env[k] = v
    t.after(() => {
      if (previous === undefined) delete process.env[k]
      else process.env[k] = previous
    })
  }
  return vars
}
test("independent processes share a stable host ID and rotate an expired grant exactly once", async (t) => {
  const vars = await isolatedInstallation(t)
  await storeRegistration("rotation", registration)
  const host = await hostIdentifier()
  const child = `import {accessForProfile} from "./lib/chatgpt-oauth.server.ts";import {hostIdentifier} from "./lib/chatgpt-vault.server.ts";let sent=0;globalThis.fetch=async(_,init)=>{if(init.body.get("refresh_token")!=="first")throw Error("reused rotation");sent++;await new Promise(r=>setTimeout(r,200));return Response.json({token_type:"Bearer",access_token:"second-access",refresh_token:"replacement",expires_in:600})};console.log(JSON.stringify([await hostIdentifier(),await accessForProfile("rotation"),sent]));`
  function run() {
    return new Promise<[string, string, number]>((resolve, reject) => {
      const p = spawn(
        process.execPath,
        [
          "--conditions",
          "react-server",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          child,
        ],
        {
          env: { ...process.env, ...vars },
          stdio: ["ignore", "pipe", "ignore"],
        }
      )
      let result = ""
      p.stdout.on("data", (d) => (result += d))
      p.on("error", reject)
      p.on("exit", (code) =>
        code === 0
          ? resolve(JSON.parse(result))
          : reject(new Error("refresh process failed"))
      )
    })
  }
  const results = await Promise.all([run(), run()])
  assert.ok(
    results.every(([h, token]) => h === host && token === "second-access")
  )
  assert.equal(
    results.reduce((sum, r) => sum + r[2], 0),
    1
  )
  assert.equal(
    await withRegistration("rotation", async (v) => v.tokens?.refresh),
    "replacement"
  )
  await assert.rejects(
    withRegistration("missing", async () => {}),
    /local ScientistFlow worker/
  )
  await storeRegistration("identity", {
    ...registration,
    tokens: { ...registration.tokens!, scopes: ["openid"] },
  })
  await assert.rejects(
    accessForProfile("identity"),
    (e: Error & { state?: string }) => e.state === "identity-only"
  )
  const accept = async () => {
    throw Error("unexpected update")
  }
  const login = await startAuthorization(registration, true, accept)
  const redirect = await fetch(login.startUrl, { redirect: "manual" })
  const url = new URL(redirect.headers.get("location")!)
  assert.equal(url.origin, "https://auth.openai.com")
  assert.equal(url.searchParams.get("client_id"), registration.clientId)
  assert.equal(url.searchParams.get("code_challenge_method"), "S256")
  const callback = new URL(url.searchParams.get("redirect_uri")!)
  assert.equal((await fetch(callback)).status, 400)
  callback.search = new URLSearchParams({
    state: url.searchParams.get("state")!,
    code: "synthetic",
    client_id: "other",
  }).toString()
  await fetch(callback)
  assert.equal(signInStatus(login.attempt).state, "failed")
  assert.match(signInStatus(login.attempt).message, /did not match/)
})

test("signed identity is bound to the issued client, verified subject and attempt nonce", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const wrong = await generateKeyPair("RS256")
  const signed = await new SignJWT({
    nonce: "fixture-nonce",
    email: "fixture@example.invalid",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("fixture-sub")
    .setIssuedAt()
    .setExpirationTime("2m")
    .setIssuer("https://auth.openai.com")
    .setAudience("fixture-client")
    .sign(privateKey)
  const verify = (
    client: string,
    nonce: string,
    sub: string,
    key = publicKey
  ) => verifiedIdentity(signed, client, nonce, sub, async () => key)
  assert.deepEqual(
    await verify("fixture-client", "fixture-nonce", "fixture-sub"),
    { subject: "fixture-sub", email: "fixture@example.invalid" }
  )
  await assert.rejects(verify("other-client", "fixture-nonce", "fixture-sub"))
  await assert.rejects(
    verify("fixture-client", "different-nonce", "fixture-sub")
  )
  await assert.rejects(
    verify("fixture-client", "fixture-nonce", "another-subject")
  )
  await assert.rejects(
    verify("fixture-client", "fixture-nonce", "fixture-sub", wrong.publicKey)
  )
})

test(
  "two persisted bot bindings select distinct vault entries, including after B is revoked",
  { skip: process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1" },
  async (t) => {
    const { SCIENTISTFLOW_INSTALLATION_ID: owner } =
      await isolatedInstallation(t)
    const { db } = await import("../lib/db"),
      { bots, chats, chatMembers, modelConnections, modelRequests } =
        await import("../db/schema")
    const { resolveBotModel } = await import("../lib/bot-model.server")
    const connections = [nanoid(), nanoid()],
      botIds = [nanoid(), nanoid()],
      efforts = ["low", "max"],
      chatId = nanoid()
    const real = globalThis.fetch
    const requests: number[] = []
    let release!: () => void
    const both = new Promise<void>((r) => (release = r))
    let revoked = false
    t.mock.method(
      globalThis,
      "fetch",
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const address = new URL(url instanceof Request ? url.url : String(url))
        if (address.hostname !== "api.openai.com") return real(url, init)
        assert.equal(address.pathname, "/v1/responses")
        const auth = new Headers(init?.headers).get("authorization")
        const index = ["Bearer fixture-0", "Bearer fixture-1"].indexOf(
          auth ?? ""
        )
        assert.ok(index >= 0)
        const body = JSON.parse(String(init?.body))
        assert.equal(body.model, modelId)
        assert.equal(body.reasoning.effort, efforts[index])
        requests.push(index)
        if (requests.length === 2) release()
        const signal = AbortSignal.timeout(10000)
        await Promise.race([
          both,
          new Promise<void>((_, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(new Error("Requests did not interleave")),
              { once: true }
            )
          ),
        ])
        return revoked && index === 1
          ? Response.json({ error: { code: "invalid_token" } }, { status: 401 })
          : streamResponse()
      }
    )
    try {
      for (const [i, id] of connections.entries()) {
        const ref = "registration-" + i
        await storeRegistration(ref, {
          ...registration,
          clientId: "client-" + i,
          tokens: {
            ...registration.tokens!,
            access: "fixture-" + i,
            expiresAt: Date.now() + 3600_000,
          },
        })
        await db.insert(modelConnections).values({
          id,
          owner,
          nickname: "Same label",
          provider: "chatgpt",
          credential: ref,
          revision: nanoid(),
          state: "ready",
          catalog: [
            {
              id: modelId,
              name: "Shared",
              efforts: [efforts[i]],
              fixedEffort: efforts[i],
              unavailable: null,
            },
          ],
        })
      }
      await db.insert(bots).values(
        botIds.map((id, i) => ({
          id,
          name: "Fixture " + i,
          job: "Profile test",
          modelChoice: {
            connectionId: connections[i],
            modelId,
            effort: i === 0 ? null : efforts[i],
          },
        }))
      )
      await db.insert(chats).values({ id: chatId, kind: "group" })
      await db
        .insert(chatMembers)
        .values(botIds.map((botId) => ({ chatId, botId })))
      async function ask(i: number) {
        const next = await resolveBotModel(
          chatId,
          botIds[i],
          nanoid(),
          nanoid()
        )
        const parts = []
        for await (const p of streamText({
          ...next(0),
          prompt: "test",
          maxRetries: 0,
          onError: () => {},
        }).fullStream)
          parts.push(p.type)
        return parts
      }
      assert.ok(
        (await Promise.all([ask(0), ask(1)])).every((parts) =>
          parts.includes("text-delta")
        )
      )
      const { renameConnection, assertCurrentConnection } =
        await import("../lib/model-connections.server")
      const [bound] = await db
        .select({ revision: modelConnections.revision })
        .from(modelConnections)
        .where(eq(modelConnections.id, connections[0]))
      await renameConnection(
        connections[0],
        bound.revision,
        "Renamed during turn"
      )
      await assertCurrentConnection(connections[0], bound.revision)
      revoked = true
      assert.ok((await ask(1)).includes("error"))
      await assert.rejects(ask(1), /invalid/)
      assert.equal(requests.filter((i) => i === 0).length, 1)
      assert.ok((await ask(0)).includes("text-delta"))
      const rows = await db
        .select()
        .from(modelRequests)
        .where(eq(modelRequests.chatId, chatId))
      assert.equal(rows.length, 4)
      assert.ok(
        rows.every(
          (r) =>
            r.connection === connections[botIds.indexOf(r.botId)].slice(-8) &&
            r.effort === efforts[botIds.indexOf(r.botId)] &&
            r.outcome === (r.httpStatus === 401 ? "failed" : "completed")
        )
      )
    } finally {
      release()
      await db.batch([
        db.delete(modelRequests).where(eq(modelRequests.chatId, chatId)),
        db.delete(chats).where(eq(chats.id, chatId)),
        db.delete(bots).where(inArray(bots.id, botIds)),
        db.delete(modelConnections).where(eq(modelConnections.owner, owner)),
      ])
    }
  }
)

test("an expired initial code retries the issued registration with fresh PKCE; declining the retry preserves existing grants", async (t) => {
  await isolatedInstallation(t)
  const originalFetch = globalThis.fetch
  let originalChallenge = "",
    exchanges = 0,
    accepted = 0
  t.mock.method(
    globalThis,
    "fetch",
    async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) !== "https://auth.openai.com/api/accounts/oauth/token")
        return originalFetch(url, init)
      const body = init?.body as URLSearchParams
      assert.equal(body.get("client_id"), "oaiapp_new")
      assert.equal(
        createHash("sha256")
          .update(body.get("code_verifier")!)
          .digest("base64url"),
        originalChallenge
      )
      exchanges++
      return Response.json({ error: "invalid_grant" }, { status: 400 })
    }
  )
  await storeRegistration("existing", registration)
  const attempt = await startAuthorization(null, false, async () => {
    accepted++
  })
  const launch = async (url: string) =>
    new URL(
      (await originalFetch(url, { redirect: "manual" })).headers.get(
        "location"
      )!
    )
  const initial = await launch(attempt.startUrl)
  assert.equal(initial.searchParams.get("client_id"), "dynamic_agent_client")
  originalChallenge = initial.searchParams.get("code_challenge")!
  const callback = new URL(initial.searchParams.get("redirect_uri")!)
  callback.search = new URLSearchParams({
    state: initial.searchParams.get("state")!,
    code: "expired",
    client_id: "oaiapp_new",
  }).toString()
  const page = await (await originalFetch(callback)).text()
  const retryPath = page.match(/href="([^"]+)"/)?.[1]
  assert.ok(retryPath)
  const retry = await launch(new URL(retryPath, callback).href)
  assert.equal(retry.searchParams.get("client_id"), "oaiapp_new")
  assert.equal(retry.searchParams.has("agent_name_hint"), false)
  for (const key of ["nonce", "state", "code_challenge"])
    assert.notEqual(retry.searchParams.get(key), initial.searchParams.get(key))
  assert.equal((await originalFetch(callback)).status, 400)
  callback.search = new URLSearchParams({
    state: retry.searchParams.get("state")!,
    error: "access_denied",
  }).toString()
  await originalFetch(callback)
  assert.equal(signInStatus(attempt.attempt).state, "failed")
  assert.equal(exchanges, 1)
  assert.equal(accepted, 0)
  assert.deepEqual(
    await withRegistration("existing", async (v) => v),
    registration
  )
})
