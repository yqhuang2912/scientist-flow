import test from "node:test"
import assert from "node:assert/strict"
import { nanoid } from "nanoid"

test("Tool actions validate before I/O, only contact the database and scope deletion to the requested ID", async (t) => {
  const id = nanoid()
  const envVar = "TOOL_FIXTURE_BEARER"
  const originalEnv = process.env
  let secretReads = 0
  process.env = new Proxy(
    {
      ...originalEnv,
      DATABASE_URL:
        "postgres://test:test@ep-fixture.us-east-2.aws.neon.tech/test",
    },
    {
      get(target, key, receiver) {
        if (key === envVar) secretReads++
        return Reflect.get(target, key, receiver)
      },
    }
  )
  t.after(() => {
    process.env = originalEnv
  })
  const requests: { query: string; params: unknown[] }[] = []
  const urls: string[] = []
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    urls.push(String(url))
    const body = JSON.parse(String(init.body))
    requests.push(body)
    // A Neon HTTP response in array mode. Actual persistence is separately checked in Settings.
    const reading = body.query.startsWith("select")
    return Response.json({
      fields: [{ name: "id", dataTypeID: 25 }],
      rows: reading ? [] : [[id]],
      rowCount: reading ? 0 : 1,
    })
  })
  const { createTool, updateTool, deleteTool } = await import("../actions/tool")
  const { getTools, getTool } = await import("../queries/tools")
  const values = {
    kind: "http",
    name: "isolated_test",
    description: "Test",
    inputSchema: { type: "object", properties: {} },
    config: {
      method: "POST",
      url: "https://example.com/isolated",
      auth: { type: "bearer_env", envVar },
    },
  }
  assert.equal(
    (await createTool({ ...values, kind: "unsupported" })).success,
    false
  )
  assert.equal(
    (
      await updateTool(id, {
        ...values,
        inputSchema: { $ref: "https://example.com/schema" },
      })
    ).success,
    false
  )
  assert.equal((await deleteTool("invalid")).success, false)
  assert.equal(requests.length, 0)
  assert.ok((await createTool(values)).success)
  assert.ok((await updateTool(id, values)).success)
  assert.deepEqual(await getTools(), { success: true, data: [] })
  assert.deepEqual(await getTool(id), {
    success: false,
    error: "This tool no longer exists.",
  })
  assert.deepEqual(await deleteTool(id), { success: true, data: { id } })
  assert.equal(requests.length, 5)
  assert.ok(urls.every((url) => new URL(url).hostname.endsWith(".neon.tech")))
  assert.equal(secretReads, 0)
  assert.match(
    requests[4].query,
    /delete from "tools" where "tools"."id" = \$1/
  )
  assert.deepEqual(requests[4].params, [id])
})
