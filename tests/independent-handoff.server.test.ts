import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises"
import { dirname } from "node:path"
import { pilotBotFile } from "../lib/deepagents-pilot.server"
import { randomBytes, randomUUID } from "node:crypto"
import { nanoid } from "nanoid"
import { eq, inArray } from "drizzle-orm"
import { readUIMessageStream, streamText, type UIMessage } from "ai"
import { botFormSchema } from "../db/schema"
import { choiceProblem, parseCatalog } from "../lib/model-catalog"

test("creation and edits require an explicit model; effort choices use model-level capabilities", () => {
  const fields = {
    name: "Rowan",
    job: "Verifier",
    avatar: "face",
    skillIds: [],
    toolIds: [],
  }
  assert.equal(botFormSchema.safeParse(fields).success, false)
  assert.equal(
    botFormSchema.safeParse({ ...fields, modelChoice: null }).success,
    false
  )
  const catalog = parseCatalog({
    data: [
      { id: "levels", reasoning: { supported_efforts: ["high", "low"] } },
      {
        id: "fixed",
        reasoning: {
          supported_efforts: ["high"],
          mandatory: true,
          default_effort: "high",
        },
      },
      { id: "unconfirmed", supported_parameters: ["tools", "reasoning"] },
      { id: "no-selector", reasoning: { mandatory: false } },
      {
        id: "gateway",
        reasoning: { supported_efforts: null, mandatory: true },
      },
    ],
  })
  const connection = {
    id: nanoid(),
    nickname: "test",
    revision: "v",
    catalog,
    state: "ready" as const,
  }
  const select = (modelId: string, effort: "high" | "low" | null) =>
    choiceProblem({ connectionId: connection.id, modelId, effort }, connection)
  assert.match(select("levels", null)!, /Select a reasoning effort/)
  assert.equal(select("levels", "low"), null)
  assert.equal(catalog.find((m) => m.id === "fixed")?.fixedEffort, "high")
  assert.equal(select("fixed", null), null)
  assert.equal(select("fixed", "high"), null)
  assert.match(select("fixed", "low")!, /unavailable/)
  assert.equal(
    catalog.find((m) => m.id === "unconfirmed")?.effortNote,
    "Levels unconfirmed"
  )
  assert.equal(
    catalog.find((m) => m.id === "no-selector")?.effortNote,
    "No selectable effort"
  )
  assert.ok(!catalog.find((m) => m.id === "gateway")?.efforts.includes("none"))
})

type RequestBody = {
  model: string
  reasoning: { effort: string }
  messages: { role: string; content: unknown }[]
  tools: { function: { name: string } }[]
}
function sse(model: string, delta: object, reason: string) {
  const event = (delta: object, finish_reason: string | null) =>
    "data: " +
    JSON.stringify({
      id: "fixture-response",
      model,
      object: "chat.completion.chunk",
      created: 1,
      choices: [{ index: 0, delta, finish_reason }],
    }) +
    "\n\n"
  return new Response(
    event(delta, null) + event({}, reason) + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } }
  )
}

test(
  "actual group runner isolates both model loops, including replay, cancellation and a disconnected recipient",
  { skip: process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1" },
  async (t) => {
    const { db } = await import("../lib/db")
    const { runBotTurn } = await import("../trigger/chat")
    const {
      botExecutions,
      bots,
      chats,
      chatMembers,
      modelRequests,
      botMemories,
      skills,
      botSkills,
      modelConnections,
      toolDefinitions,
      botTools,
    } = await import("../db/schema")
    const { sealCredential } = await import("../lib/model-credentials.server")
    const owner = randomUUID()
    const beforeOwner = process.env.SCIENTISTFLOW_INSTALLATION_ID,
      beforeMaster = process.env.SCIENTISTFLOW_MODEL_MASTER_KEY
    process.env.SCIENTISTFLOW_INSTALLATION_ID = owner
    process.env.SCIENTISTFLOW_MODEL_MASTER_KEY =
      randomBytes(32).toString("base64")
    const [a, b, ca, cb, chatId, skillId, httpId] = Array.from(
      { length: 7 },
      () => nanoid()
    )
    const skillName = "iris-" + skillId.toLowerCase().replace(/_/g, "x"),
      httpName = "rowan_" + httpId.toLowerCase().replace(/-/g, "x")
    const firstModel = "fixture/a:free",
      otherModel = "fixture/b:free"
    const catalog = [firstModel, otherModel].map((id) => ({
      id,
      name: id,
      efforts: ["low", "high"] as ("low" | "high")[],
      unavailable: null,
    }))
    const realFetch = globalThis.fetch
    let sent: { key: string; body: RequestBody }[] = []
    let rejectTarget = false
    globalThis.fetch = async (url, init) => {
      if (String(url) !== "https://openrouter.ai/api/v1/chat/completions")
        return realFetch(url, init)
      const key = new Headers(init?.headers).get("authorization") ?? ""
      const body: RequestBody = JSON.parse(String(init?.body))
      sent.push({ key, body })
      const call = (index: number, name: string, args: object) => ({
        index,
        id: "fixture-call-" + index + "-" + name,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      })
      if (!body.tools?.length)
        return sse(body.model, { content: "One public reply" }, "stop")
      if (key === "Bearer fixture-rowan")
        return sse(body.model, { content: "63，Rowan" }, "stop")
      const n = sent.filter((r) => r.key === key).length
      if (n === 1) {
        const label = JSON.stringify(body.messages).match(
          /\[(S-[a-f0-9]+)\] Public trial/
        )?.[1]
        return sse(
          body.model,
          {
            reasoning: "IRIS_LIVE_THOUGHT",
            tool_calls: [
              call(0, "read_skill", { name: skillName }),
              call(1, "record_project_decision", {
                decision: "Verify the public dimensions",
                source: label,
                quote: "Public trial uses seven rows of nine.",
              }),
            ],
          },
          "tool_calls"
        )
      }
      if (rejectTarget && n > 2)
        return sse(
          body.model,
          { content: "The target needs configuration." },
          "stop"
        )
      return sse(
        body.model,
        {
          tool_calls: [
            call(0, "handoff", {
              botName: "Rowan",
              reason: "PUBLIC_DELEGATION: check the grid.",
            }),
          ],
        },
        "tool_calls"
      )
    }
    const user = (): UIMessage => ({
      id: nanoid(),
      role: "user",
      parts: [
        {
          type: "text",
          text: "Public trial uses seven rows of nine. Record it and delegate.",
        },
      ],
    })
    const history: UIMessage[] = [
      {
        id: "system",
        role: "system",
        parts: [{ type: "text", text: "PRIVATE_HISTORY_SYSTEM" }],
      },
      {
        id: "prior-b",
        role: "assistant",
        metadata: { botId: b },
        parts: [{ type: "text", text: "Rowan public history" }],
      },
      {
        id: "prior-a",
        role: "assistant",
        metadata: {
          botId: a,
          executionId: "previous",
          previousResponseId: "PRIVATE_POINTER",
        },
        parts: [
          {
            type: "text",
            text: "Iris public history",
            providerMetadata: { fixture: { signature: "PRIVATE_SIGNATURE" } },
          },
          { type: "reasoning", text: "PRIVATE_THOUGHT" },
          {
            type: "tool-private",
            toolCallId: "PRIVATE_CALL",
            state: "output-available",
            input: {},
            output: "PRIVATE_TOOL_OUTPUT",
          },
        ],
      },
    ]
    async function run(
      input: UIMessage,
      controller = new AbortController(),
      onParent?: () => Promise<void>
    ) {
      let transcript: UIMessage[] = []
      await runBotTurn({
        chatId,
        requestedBotId: a,
        runId: nanoid(),
        signal: controller.signal,
        streamText,
        transcript: [...history, input],
        messages: [{ role: "system", content: "UNFILTERED_RUNNER_HISTORY" }],
        publish: async (stream, parent) => {
          let message: UIMessage | undefined
          for await (const m of readUIMessageStream({ stream })) message = m
          if (!parent) await onParent?.()
          return message
        },
        saveHistory: (all) => {
          transcript = all
        },
      })
      return transcript.slice(history.length)
    }
    const flag = pilotBotFile() // unique fixture installation, separate from the real worker
    await mkdir(dirname(flag), { recursive: true })
    await writeFile(flag, a, { flag: "wx" })
    try {
      await db.insert(modelConnections).values(
        [
          [ca, "iris"],
          [cb, "rowan"],
        ].map(([id, name]) => ({
          id,
          owner,
          nickname: name,
          revision: nanoid(),
          catalog,
          state: "ready" as const,
          credential: sealCredential(owner, id, "fixture-" + name),
        }))
      )
      await db.insert(bots).values([
        {
          id: a,
          name: "Iris",
          job: "Intake",
          instructions: "IRIS_PRIVATE_PERSONA",
          modelChoice: { connectionId: ca, modelId: firstModel, effort: "low" },
        },
        {
          id: b,
          name: "Rowan",
          job: "Verifier",
          instructions: "ROWAN_PERSONA",
          modelChoice: {
            connectionId: cb,
            modelId: otherModel,
            effort: "high",
          },
        },
      ])
      await db.insert(chats).values({ id: chatId, kind: "group" })
      await db.batch([
        db
          .insert(chatMembers)
          .values([a, b].map((botId) => ({ botId, chatId }))),
        db.insert(botMemories).values([
          { botId: a, text: "IRIS_PRIVATE_MEMORY" },
          { botId: b, text: "ROWAN_PRIVATE_MEMORY" },
        ]),
        db.insert(skills).values({
          id: skillId,
          name: skillName,
          description: "IRIS_PRIVATE_CATALOG",
          instructions: "IRIS_PRIVATE_SKILL_BODY",
        }),
        db.insert(botSkills).values({ botId: a, skillId }),
        db.insert(toolDefinitions).values({
          id: httpId,
          kind: "http",
          name: httpName,
          description: "ROWAN_TOOL_SCHEMA",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
          config: {
            method: "GET",
            url: "https://example.org/fixture",
            auth: { type: "none" },
          },
        }),
        db.insert(botTools).values({ botId: b, toolId: httpId }),
      ])
      await t.test(
        "one direct bot uses the pilot, another uses the original runner, and replay reuses the claimed message",
        async () => {
          const direct = nanoid(),
            other = nanoid()
          try {
            await db.insert(chats).values([{ id: direct }, { id: other }])
            await db.insert(chatMembers).values([
              { chatId: direct, botId: a },
              { chatId: other, botId: b },
            ])
            const input = user()
            const invoke = async (id: string) => {
              let history: UIMessage[] = []
              await runBotTurn({
                chatId: id,
                runId: nanoid(),
                signal: new AbortController().signal,
                streamText,
                messages: [{ role: "user", content: "Question" }],
                transcript: [input],
                publish: async (stream) => {
                  let last
                  for await (const message of readUIMessageStream({ stream }))
                    last = message
                  return last
                },
                saveHistory: (all) => {
                  history = all
                },
              })
              return history[1]
            }
            sent = []
            const reply = await invoke(direct)
            assert.equal(
              (reply.metadata as { engine: string }).engine,
              "deepagents"
            )
            assert.deepEqual(
              reply.parts.map((p) => p.type === "text" && p.text),
              ["One public reply"]
            )
            assert.deepEqual((await invoke(direct)).id, reply.id)
            assert.equal(sent.length, 1)
            assert.deepEqual(
              [sent[0].key, sent[0].body.model, sent[0].body.reasoning.effort],
              ["Bearer fixture-iris", firstModel, "low"]
            )
            const [execution] = await db
              .select()
              .from(botExecutions)
              .where(eq(botExecutions.messageId, reply.id))
            assert.equal(execution.status, "completed")
            const attempts = await db
              .select()
              .from(modelRequests)
              .where(eq(modelRequests.executionId, execution.id))
            assert.deepEqual(
              attempts.map((r) => [r.connection, r.httpStatus]),
              [[ca.slice(-8), 200]]
            )
            const legacy = await invoke(other)
            assert.equal(
              (legacy.metadata as { engine?: string }).engine,
              undefined
            )
            assert.equal(sent[1].key, "Bearer fixture-rowan")
            assert.ok(sent[1].body.tools.length)
          } finally {
            await db.batch([
              db
                .delete(modelRequests)
                .where(inArray(modelRequests.chatId, [direct, other])),
              db.delete(chats).where(inArray(chats.id, [direct, other])),
            ])
          }
        }
      )
      for (const modelId of [otherModel, firstModel]) {
        await t.test(
          "independent recipient first request for " + modelId,
          async () => {
            await db
              .update(bots)
              .set({
                modelChoice: { connectionId: cb, modelId, effort: "high" },
              })
              .where(eq(bots.id, b))
            const input = user()
            sent = []
            const turn = await run(input)
            assert.equal(turn.length, 3)
            const [, iris, rowan] = turn
            assert.notEqual(iris.id, rowan.id)
            const im = iris.metadata as { executionId: string; botId: string },
              rm = rowan.metadata as {
                executionId: string
                parentExecutionId: string
                botId: string
              }
            assert.deepEqual([im.botId, rm.botId], [a, b])
            assert.notEqual(im.executionId, rm.executionId)
            assert.equal(rm.parentExecutionId, im.executionId)
            assert.deepEqual(
              sent.map((r) => r.key),
              [
                "Bearer fixture-iris",
                "Bearer fixture-iris",
                "Bearer fixture-rowan",
              ]
            )
            const source = JSON.stringify(sent[1].body)
            for (const marker of [
              "IRIS_PRIVATE_MEMORY",
              "IRIS_PRIVATE_SKILL_BODY",
              "IRIS_PRIVATE_PERSONA",
            ])
              assert.ok(source.includes(marker), marker)
            const body = sent[2].body,
              serialized = JSON.stringify(body)
            assert.deepEqual(
              [body.model, body.reasoning.effort],
              [modelId, "high"]
            )
            const [execution] = await db
              .select()
              .from(botExecutions)
              .where(eq(botExecutions.id, rm.executionId))
            const ref = execution.delegation?.evidence.find(
              (r) => r.messageId === input.id
            )
            assert.ok(ref)
            for (const marker of [
              "PUBLIC_DELEGATION",
              "Public trial uses seven rows of nine.",
              ref.decisionId,
              input.id,
              "ROWAN_PRIVATE_MEMORY",
              "ROWAN_TOOL_SCHEMA",
              httpName,
            ])
              assert.ok(serialized.includes(marker), marker)
            for (const marker of [
              "IRIS_PRIVATE",
              "IRIS_LIVE_THOUGHT",
              "PRIVATE_SIGNATURE",
              "PRIVATE_THOUGHT",
              "PRIVATE_POINTER",
              "PRIVATE_CALL",
              "PRIVATE_TOOL_OUTPUT",
              "PRIVATE_HISTORY_SYSTEM",
              "UNFILTERED_RUNNER_HISTORY",
            ])
              assert.ok(!serialized.includes(marker), marker)
            assert.ok(!body.messages.some((m) => m.role === "tool"))
            assert.ok(!body.tools.some((s) => s.function.name === "handoff"))
            assert.ok(
              body.messages.some(
                (m) =>
                  m.role === "user" &&
                  JSON.stringify(m.content).includes("Iris public history") &&
                  JSON.stringify(m.content).includes("groupMember")
              )
            )
            assert.ok(
              body.messages.some(
                (m) =>
                  m.role === "assistant" &&
                  JSON.stringify(m.content).includes("Rowan public history")
              )
            )
            const replay = await Promise.all([run(input), run(input)])
            for (const replayed of replay)
              assert.deepEqual(
                replayed.map((m) => m.id),
                turn.map((m) => m.id)
              )
            assert.equal(sent.length, 3)
          }
        )
      }
      await t.test(
        "concurrent delivery of one new user message claims each execution once",
        async () => {
          const input = user()
          sent = []
          await Promise.all([run(input), run(input)])
          const restored = await run(input)
          assert.equal(restored.length, 3)
          assert.equal(new Set(restored.map((m) => m.id)).size, 3)
          assert.deepEqual(
            sent.map((r) => r.key),
            [
              "Bearer fixture-iris",
              "Bearer fixture-iris",
              "Bearer fixture-rowan",
            ]
          )
        }
      )
      await t.test(
        "cancellation before and during delegation cannot dispatch or replay a recipient",
        async () => {
          const controller = new AbortController()
          controller.abort()
          sent = []
          const stopped = await run(user(), controller)
          assert.equal(stopped.length, 2)
          assert.equal(sent.length, 0)
          const input = user(),
            during = new AbortController()
          const after = await run(input, during, async () => during.abort())
          assert.equal(after.length, 2)
          assert.ok(sent.every((r) => r.key === "Bearer fixture-iris"))
          const n = sent.length
          const again = await run(input)
          assert.deepEqual(
            again.map((m) => m.id),
            after.map((m) => m.id)
          )
          const [record] = await db
            .select()
            .from(botExecutions)
            .where(eq(botExecutions.messageId, after[1].id))
          assert.equal(record.status, "cancelled")
          assert.equal(sent.length, n)
        }
      )
      await t.test(
        "revocation after dispatch intent fails as Rowan; an already disconnected target is rejected by Iris",
        async () => {
          const input = user()
          sent = []
          const failed = await run(input, undefined, async () => {
            await db
              .update(modelConnections)
              .set({ state: "disconnected", credential: null })
              .where(eq(modelConnections.id, cb))
          })
          assert.equal(failed.length, 3)
          assert.match(JSON.stringify(failed[2].parts), /Disconnected/)
          assert.ok(sent.every((r) => r.key === "Bearer fixture-iris"))
          const n = sent.length
          await run(input)
          assert.equal(sent.length, n)
          rejectTarget = true
          sent = []
          const denied = await run(user())
          assert.equal(denied.length, 2)
          assert.match(JSON.stringify(denied[1].parts), /Disconnected/)
          assert.ok(sent.every((r) => r.key === "Bearer fixture-iris"))
        }
      )
    } finally {
      await unlink(flag)
      await rmdir(dirname(flag))
      globalThis.fetch = realFetch
      if (beforeOwner === undefined)
        delete process.env.SCIENTISTFLOW_INSTALLATION_ID
      else process.env.SCIENTISTFLOW_INSTALLATION_ID = beforeOwner
      if (beforeMaster === undefined)
        delete process.env.SCIENTISTFLOW_MODEL_MASTER_KEY
      else process.env.SCIENTISTFLOW_MODEL_MASTER_KEY = beforeMaster
      await db.batch([
        db.delete(modelRequests).where(eq(modelRequests.chatId, chatId)),
        db.delete(chats).where(eq(chats.id, chatId)),
        db.delete(bots).where(inArray(bots.id, [a, b])),
        db.delete(skills).where(eq(skills.id, skillId)),
        db.delete(toolDefinitions).where(eq(toolDefinitions.id, httpId)),
        db.delete(modelConnections).where(eq(modelConnections.owner, owner)),
      ])
    }
  }
)
