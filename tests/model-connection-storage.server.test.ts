import { strict as assert } from "node:assert"
import { randomBytes, randomUUID } from "node:crypto"
import { test } from "node:test"
import { eq } from "drizzle-orm"

test(
  "Neon scopes independent connections and rejects late refresh, stale models and revoked credentials",
  { skip: process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1" },
  async () => {
    const { db } = await import("../lib/db")
    const { modelConnections } = await import("../db/schema")
    const {
      connect,
      listConnections,
      validateChoice,
      resolveConnection,
      assertCurrentConnection,
      invalidateCredential,
      refreshConnection,
      disconnectConnection,
      chatMemberChoice,
    } = await import("../lib/model-connections.server")
    const owner = randomUUID()
    const oldOwner = process.env.SCIENTISTFLOW_INSTALLATION_ID,
      oldMaster = process.env.SCIENTISTFLOW_MODEL_MASTER_KEY
    const fetchReal = globalThis.fetch
    process.env.SCIENTISTFLOW_INSTALLATION_ID = owner
    process.env.SCIENTISTFLOW_MODEL_MASTER_KEY =
      randomBytes(32).toString("base64")
    const modelId = "fixture/shared"
    const keys = new Map([
      ["fixture-a", modelId],
      ["fixture-b", modelId],
      ["rotated-a", "fixture/replacement"],
    ])
    let delayRefresh = false
    let announce!: () => void, release!: () => void
    const entered = new Promise<void>((r) => {
        announce = r
      }),
      resume = new Promise<void>((r) => {
        release = r
      })
    globalThis.fetch = async (url, init) => {
      const destination = new URL(
        url instanceof Request ? url.url : String(url)
      )
      if (destination.hostname !== "openrouter.ai") return fetchReal(url, init)
      const key =
        new Headers(init?.headers).get("authorization")?.slice(7) ?? ""
      assert.ok(keys.has(key))
      if (destination.pathname.endsWith("/key"))
        return Response.json({ data: {} })
      assert.equal(destination.pathname, "/api/v1/models/user")
      if (delayRefresh && key === "fixture-a") {
        announce()
        await resume
      }
      return Response.json({
        data: [{ id: keys.get(key), supported_parameters: ["tools"] }],
      })
    }
    try {
      await Promise.all([
        connect({ nickname: "A", apiKey: "fixture-a" }),
        connect({ nickname: "B", apiKey: "fixture-b" }),
      ])
      const [a, b] = await listConnections()
      assert.notEqual(a.id, b.id)
      assert.deepEqual(a.catalog, b.catalog)
      assert.ok(!JSON.stringify(a).includes("fixture-a"))
      const choiceA = { connectionId: a.id, modelId, effort: null },
        choiceB = { ...choiceA, connectionId: b.id }
      assert.equal((await resolveConnection(choiceA)).apiKey, "fixture-a")
      assert.equal((await resolveConnection(choiceB)).apiKey, "fixture-b")
      process.env.SCIENTISTFLOW_INSTALLATION_ID = randomUUID()
      assert.equal((await listConnections()).length, 0)
      await assert.rejects(resolveConnection(choiceA), /unavailable/)
      await assert.rejects(disconnectConnection(a.id, a.revision), /changed/)
      process.env.SCIENTISTFLOW_INSTALLATION_ID = owner
      await assert.rejects(
        chatMemberChoice(randomUUID(), randomUUID()),
        /member/
      )
      delayRefresh = true
      const oldRefresh = refreshConnection(a.id, a.revision)
      await entered
      try {
        await connect({ nickname: "A", apiKey: "rotated-a" }, a)
      } finally {
        release()
      }
      await assert.rejects(oldRefresh, /changed/)
      const [rotated] = await listConnections()
      await invalidateCredential(a.id, a.revision)
      await assertCurrentConnection(rotated.id, rotated.revision)
      assert.notEqual(rotated.revision, a.revision)
      assert.equal(rotated.catalog[0].id, "fixture/replacement")
      await assert.rejects(validateChoice(choiceA), /no longer/)
      await assert.rejects(assertCurrentConnection(a.id, a.revision), /changed/)
      await disconnectConnection(rotated.id, rotated.revision)
      await assert.rejects(
        resolveConnection({ ...choiceA, modelId: "fixture/replacement" }),
        /Disconnected/
      )
      const [stored] = await db
        .select({ credential: modelConnections.credential })
        .from(modelConnections)
        .where(eq(modelConnections.id, a.id))
      assert.equal(stored.credential, null)
      assert.equal((await resolveConnection(choiceB)).apiKey, "fixture-b")
    } finally {
      release()
      globalThis.fetch = fetchReal
      await db.delete(modelConnections).where(eq(modelConnections.owner, owner))
      if (oldOwner === undefined)
        delete process.env.SCIENTISTFLOW_INSTALLATION_ID
      else process.env.SCIENTISTFLOW_INSTALLATION_ID = oldOwner
      if (oldMaster === undefined)
        delete process.env.SCIENTISTFLOW_MODEL_MASTER_KEY
      else process.env.SCIENTISTFLOW_MODEL_MASTER_KEY = oldMaster
    }
  }
)
