import assert from "node:assert/strict"
import { test } from "node:test"
import { Readable } from "node:stream"
import type { ToolRequest } from "../lib/public-https"
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises"
import { dirname } from "node:path"
import { pilotBotFile, pilotGroupFile } from "../lib/deepagents-pilot.server"
import {
  getHandoff,
  getSkillReadPresentation,
  getToolPresentation,
} from "../lib/chat-presentation"
import { serializeSkillToMarkdown } from "../lib/skill-definition"
import { randomBytes, randomInt, randomUUID } from "node:crypto"
import { nanoid } from "nanoid"
import { eq, inArray } from "drizzle-orm"
import { readUIMessageStream, type UIMessage } from "ai"
import { botFormSchema } from "../db/schema"
import { choiceProblem, parseCatalog } from "../lib/model-catalog"
import {
  projectDecisionMediaType,
  projectRecallTool,
} from "../lib/project-decisions"

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
  messages: {
    role: string
    content: unknown
    tool_call_id?: string
    tool_calls?: { id: string }[]
  }[]
  tools: { function: { name: string } }[]
}
function sse(
  model: string,
  delta: object,
  reason: string,
  continuation?: object
) {
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
    event(delta, null) +
      (continuation ? event(continuation, null) : "") +
      event({}, reason) +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } }
  )
}

test(
  "actual group runner isolates both model loops, including replay, cancellation and a disconnected recipient",
  { skip: process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1" },
  async (t) => {
    const { db } = await import("../lib/db")
    const { runBotTurn } = await import("../lib/chat-turn.server")
    const {
      botExecutions,
      bots,
      chats,
      chatMembers,
      modelRequests,
      projectDecisions,
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
    let pilotResponse: "success" | "denied" | undefined
    let lookupMode: "bound" | "revoked" | "forbidden" | undefined
    let requestedSkill: string | undefined
    let combinedSkill: string | undefined
    let saveMeasurement = false
    let recall:
      | ((
          body: RequestBody
        ) => Promise<{ recordId: string | null; answer: string }>)
      | undefined
    let observation: number | undefined
    let sample: string | undefined
    const sends: string[] = []
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
      if (recall)
        return sse(
          body.model,
          { tool_calls: [call(0, projectRecallTool, await recall(body))] },
          "tool_calls"
        )
      if (pilotResponse) {
        if (combinedSkill && key === "Bearer fixture-rowan") {
          const last = body.messages.at(-1)
          if (last?.role !== "tool")
            return sse(
              body.model,
              { tool_calls: [call(0, "read_skill", { name: combinedSkill })] },
              "tool_calls"
            )
          if (last.tool_call_id === "fixture-call-0-read_skill") {
            const topic = /Lookup topic: (\S+)/.exec(String(last.content))?.[1]
            assert.ok(topic)
            return sse(
              body.model,
              { tool_calls: [call(0, httpName, { topic })] },
              "tool_calls"
            )
          }
          if (last.tool_call_id === "fixture-call-0-record_project_decision") {
            const receipt = JSON.parse(String(last.content))
            assert.ok(receipt.success)
            return sse(
              body.model,
              { content: receipt.decision + " · " + receipt.id },
              "stop"
            )
          }
          const {
            evidenceRef,
            data: { value },
          } = JSON.parse(String(last.content))
          if (saveMeasurement)
            return sse(
              body.model,
              {
                tool_calls: [
                  call(0, "record_project_decision", {
                    source: evidenceRef,
                    decision:
                      "Observed " +
                      value +
                      "; doubled measurement: " +
                      value * 2,
                    fields: [{ path: "/value", value: String(value) }],
                  }),
                ],
              },
              "tool_calls"
            )
          return sse(
            body.model,
            { content: "Doubled measurement: " + value * 2 },
            "stop"
          )
        }
        if (requestedSkill && key === "Bearer fixture-rowan") {
          return body.messages.at(-1)?.role !== "tool"
            ? sse(
                body.model,
                {
                  tool_calls: [call(0, "read_skill", { name: requestedSkill })],
                },
                "tool_calls"
              )
            : sse(body.model, { content: "Measured result: 518" }, "stop")
        }
        if (lookupMode && key === "Bearer fixture-rowan") {
          if (body.tools?.length) {
            if (lookupMode === "revoked")
              await db.delete(botTools).where(eq(botTools.toolId, httpId))
            const name =
              lookupMode === "forbidden" ? httpName + "_iris" : httpName
            return sse(
              body.model,
              {
                reasoning: "PRIVATE_LOOKUP_THOUGHT",
                tool_calls: [
                  call(0, name, { topic: "PRIVATE_LOOKUP_ARGUMENT" }),
                ],
              },
              "tool_calls"
            )
          }
          const result = body.messages.at(-1)
          assert.ok(
            JSON.stringify(body.messages[0]).includes(
              "Current server date (UTC): " +
                new Date().toISOString().slice(0, 10)
            )
          )
          assert.equal(result?.role, "tool")
          assert.equal(result.tool_call_id, "fixture-call-0-" + httpName)
          assert.equal(
            body.messages.at(-2)?.tool_calls?.[0].id,
            result.tool_call_id
          )
          if (lookupMode === "revoked") {
            assert.match(
              String(result.content),
              /binding or tool definition changed/
            )
            return sse(body.model, { content: "Unverified value" }, "stop")
          }
          const value = JSON.parse(String(result.content)).sample
          assert.equal(value, sample)
          return sse(body.model, { content: "Observed: " + value }, "stop")
        }
        if (key === "Bearer fixture-rowan")
          return pilotResponse === "denied"
            ? new Response(null, { status: 403 })
            : sse(body.model, { content: "37 × 14 = 518" }, "stop")
        return sse(
          body.model,
          {
            tool_calls: [
              {
                index: 0,
                id: "split-call",
                type: "function",
                function: { name: "handoff", arguments: '{"botName":"Ro' },
              },
            ],
          },
          "tool_calls",
          {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments:
                    'wan","reason":"PUBLIC_DELEGATION: verify 37 times 14."}',
                },
              },
            ],
          }
        )
      }
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
        httpTransport: async (req: ToolRequest) => {
          sends.push(req.url.pathname)
          if (combinedSkill) {
            assert.equal(req.url.searchParams.get("topic"), "cohort-cobalt-17")
            observation = randomInt(20, 2000)
            return {
              status: 200,
              contentType: "application/json",
              body: Readable.from([
                JSON.stringify({
                  value: observation,
                  private: "RAW_MEASUREMENT",
                }),
              ]),
            }
          }
          assert.equal(
            req.url.searchParams.get("topic"),
            "PRIVATE_LOOKUP_ARGUMENT"
          )
          assert.equal(req.audit?.toolCallId, "fixture-call-0-" + httpName)
          sample = randomUUID()
          return {
            status: 200,
            contentType: "application/json",
            body: Readable.from([
              JSON.stringify({ sample, detail: "PRIVATE_RAW_DETAIL" }),
            ]),
          }
        },
        transcript: [...history, input],
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
            properties: {
              topic: { type: "string", description: "Lookup topic" },
            },
            required: ["topic"],
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
        "one direct bot uses the pilot, another uses its assigned tools, and replay reuses the claimed message",
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
              "deepagents"
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
      await t.test(
        "the two scoped Deep Agents use separate credentials for the same model and preserve a completed handoff on recipient failure or replay",
        async (groupTest) => {
          const groupFlag = pilotGroupFile()
          await db
            .update(bots)
            .set({
              modelChoice: {
                connectionId: cb,
                modelId: firstModel,
                effort: "high",
              },
            })
            .where(eq(bots.id, b))
          await writeFile(
            groupFlag,
            JSON.stringify({ chatId, senderId: a, recipientId: b }),
            { flag: "wx" }
          )
          try {
            await groupTest.test(
              "a fresh sender recalls only its group's active evidence, with a durable citation",
              async () => {
                const otherGroup = nanoid()
                const value = randomUUID()
                const foreign = randomUUID()
                const toolEvidence = (reading: string) => ({
                  executionId: nanoid(),
                  toolCallId: nanoid(),
                  toolId: httpId,
                  toolName: httpName,
                  digest: randomBytes(32).toString("hex"),
                  fields: [
                    { path: "/reading", value: reading },
                    { path: "/unit", value: "ms" },
                  ],
                })
                const source = toolEvidence(value)
                const fixture = {
                  creatorBotId: b,
                  creatorName: "Rowan",
                  sourceMessageId: nanoid(),
                  sourceRole: "assistant" as const,
                  sourceAuthor: httpName,
                  quote: "",
                  fingerprint: nanoid(),
                }
                const ask = (): UIMessage => ({
                  id: nanoid(),
                  role: "user",
                  parts: [
                    {
                      type: "text",
                      text: "What did we conclude about wave latency and what supported it?",
                    },
                  ],
                })
                await db.insert(chats).values({ id: otherGroup, kind: "group" })
                try {
                  const [local, other] = await db
                    .insert(projectDecisions)
                    .values([
                      {
                        ...fixture,
                        chatId,
                        decision: "Wave latency met the target",
                        toolEvidence: source,
                      },
                      {
                        ...fixture,
                        chatId: otherGroup,
                        decision: "Wave latency missed the target",
                        toolEvidence: toolEvidence(foreign),
                      },
                    ])
                    .returning()
                  sent = []
                  sends.length = 0
                  recall = async (body) => {
                    assert.ok(
                      body.tools.some(
                        (t) => t.function.name === projectRecallTool
                      )
                    )
                    const prompt = body.messages
                      .filter((m) => m.role === "system")
                      .flatMap((m) =>
                        typeof m.content === "string"
                          ? [m.content]
                          : Array.isArray(m.content)
                            ? m.content.map((p) => p.text)
                            : []
                      )
                      .join("\n")
                    const list = JSON.parse(
                      prompt.match(
                        /Active research decisions for this project\.[^\n]*\n([^\n]+)/
                      )![1]
                    )
                    const record = list.find((r: { decision: string }) =>
                      r.decision.includes("Wave latency")
                    )
                    assert.ok(
                      !JSON.stringify(
                        body.messages.filter((m) => m.role !== "system")
                      ).includes(value)
                    )
                    assert.ok(
                      !prompt.includes(foreign) && !prompt.includes(other.id)
                    )
                    assert.equal(record.evidence.toolCallId, source.toolCallId)
                    return {
                      recordId: record.recordId,
                      answer:
                        record.decision +
                        ": " +
                        record.evidence.fields
                          .map((f: { value: string }) => f.value)
                          .join(" "),
                    }
                  }
                  const request = ask()
                  const turn = await run(request)
                  assert.equal(turn.length, 2)
                  const reply = turn[1]
                  assert.equal((reply.metadata as { botId: string }).botId, a)
                  assert.deepEqual(reply.parts, [
                    {
                      type: "text",
                      text: local.decision + ": " + value + " ms",
                      state: "done",
                    },
                    {
                      type: "source-document",
                      sourceId: local.id,
                      mediaType: projectDecisionMediaType,
                      title: local.id,
                    },
                  ])
                  assert.deepEqual(await run(request), turn)
                  assert.equal(sent.length, 1)
                  assert.equal(sent[0].key, "Bearer fixture-iris")
                  for (const which of [
                    "foreign",
                    "withdraw while answering",
                    "already withdrawn",
                  ] as const) {
                    recall = async (body) => {
                      const inContext = JSON.stringify(
                        body.messages.filter((m) => m.role === "system")
                      ).includes(local.id)
                      assert.equal(inContext, which !== "already withdrawn")
                      if (which === "withdraw while answering")
                        await db
                          .update(projectDecisions)
                          .set({ withdrawnAt: new Date() })
                          .where(eq(projectDecisions.id, local.id))
                      return {
                        recordId: which === "foreign" ? other.id : local.id,
                        answer: "Stale assertion " + value,
                      }
                    }
                    const withOldReceipt = which === "already withdrawn"
                    if (withOldReceipt) history.push(reply)
                    const [, refused] = await run(ask()).finally(() => {
                      if (withOldReceipt) history.pop()
                    })
                    assert.deepEqual(
                      refused.parts.map((p) => p.type),
                      ["text"]
                    )
                    assert.match(
                      JSON.stringify(refused.parts),
                      /No matching active decision/
                    )
                    assert.ok(!JSON.stringify(refused.parts).includes(value))
                  }
                  assert.equal(sends.length, 0)
                  assert.equal(
                    (
                      await db
                        .select()
                        .from(projectDecisions)
                        .where(eq(projectDecisions.chatId, chatId))
                    ).length,
                    1
                  )
                } finally {
                  recall = undefined
                  await db
                    .delete(projectDecisions)
                    .where(
                      eq(projectDecisions.fingerprint, fixture.fingerprint)
                    )
                  await db.delete(chats).where(eq(chats.id, otherGroup))
                }
              }
            )
            for (const outcome of ["success", "denied"] as const) {
              pilotResponse = outcome
              sent = []
              const input = user()
              const turn = await run(input)
              const [, source, target] = turn
              assert.equal(turn.length, 3, JSON.stringify(source?.parts))
              assert.deepEqual(source.parts.map(getHandoff).filter(Boolean), [
                {
                  sourceName: "Iris",
                  sourceId: a,
                  targetName: "Rowan",
                  targetId: b,
                  reason: "PUBLIC_DELEGATION: verify 37 times 14.",
                },
              ])
              assert.ok(
                source.parts.some(
                  (p) =>
                    p.type === "tool-handoff" && p.toolCallId === "split-call"
                )
              )
              const executions = await db
                .select()
                .from(botExecutions)
                .where(eq(botExecutions.userMessageId, input.id))
                .orderBy(botExecutions.slot)
              assert.equal(executions.length, 2)
              const [parent, child] = executions
              assert.deepEqual(
                [parent.status, child.status],
                ["completed", outcome === "success" ? "completed" : "failed"]
              )
              assert.equal(child.parentExecutionId, parent.id)
              assert.notEqual(source.id, target.id)
              for (const [i, msg] of [source, target].entries()) {
                assert.equal(executions[i].messageId, msg.id)
                assert.deepEqual(msg.metadata, {
                  executionId: executions[i].id,
                  userMessageId: input.id,
                  parentExecutionId: i ? parent.id : null,
                  botId: i ? b : a,
                  engine: "deepagents",
                })
                const receipts = await db
                  .select()
                  .from(modelRequests)
                  .where(eq(modelRequests.executionId, executions[i].id))
                assert.deepEqual(
                  receipts.map((r) => [
                    r.connection,
                    r.model,
                    r.effort,
                    r.httpStatus,
                  ]),
                  [
                    [
                      (i ? cb : ca).slice(-8),
                      firstModel,
                      i ? "high" : "low",
                      i && outcome === "denied" ? 403 : 200,
                    ],
                  ]
                )
              }
              assert.deepEqual(
                sent.map((r) => [
                  r.key,
                  r.body.model,
                  r.body.reasoning.effort,
                  r.body.tools?.map((t) => t.function.name) ?? [],
                ]),
                [
                  [
                    "Bearer fixture-iris",
                    firstModel,
                    "low",
                    ["handoff", projectRecallTool],
                  ],
                  ["Bearer fixture-rowan", firstModel, "high", [httpName]],
                ]
              )
              const recipientInput = JSON.stringify(sent[1].body.messages)
              for (const marker of [
                "PUBLIC_DELEGATION",
                "Iris public history",
                "ROWAN_PRIVATE_MEMORY",
                "Public trial",
              ])
                assert.ok(recipientInput.includes(marker))
              assert.doesNotMatch(
                recipientInput,
                /IRIS_PRIVATE|PRIVATE_THOUGHT|PRIVATE_TOOL_OUTPUT|PRIVATE_POINTER|PRIVATE_SIGNATURE/
              )
              assert.match(
                JSON.stringify(target.parts),
                outcome === "success" ? /518/ : /denied access/
              )
              assert.deepEqual(await run(input), turn)
              assert.equal(sent.length, 2)
            }
            await groupTest.test(
              "recipient selects from its own catalog and receives only the selected version in its follow-up",
              async (catalogTest) => {
                const suffix = randomBytes(5).toString("hex")
                const [distractor, relevant] = await db
                  .insert(skills)
                  .values([
                    {
                      name: "agenda-" + suffix,
                      description: "Prepare a meeting",
                      instructions: "DISTRACTOR_BODY",
                    },
                    {
                      name: "verify-" + suffix,
                      description: "Verify a numerical result",
                      instructions:
                        "PRIVATE_METHOD: multiply the public dimensions; start with Measured result. When checking a measurement, query the lookup tool. Lookup topic: cohort-cobalt-17\nDouble the observed value.",
                    },
                  ])
                  .returning()
                const ids = [distractor.id, relevant.id]
                try {
                  await db
                    .insert(botSkills)
                    .values(ids.map((skillId) => ({ botId: b, skillId })))
                  for (const allowed of [true, false]) {
                    requestedSkill = allowed ? relevant.name : skillName
                    pilotResponse = "success"
                    sent = []
                    const input = user()
                    const turn = await run(input)
                    const [, source, recipient] = turn
                    assert.ok(source.parts.map(getHandoff).some(Boolean))
                    assert.equal(
                      (recipient.metadata as { botId: string }).botId,
                      b
                    )
                    assert.deepEqual(
                      sent.map((row) => [
                        row.key,
                        row.body.model,
                        row.body.reasoning.effort,
                      ]),
                      [
                        ["Bearer fixture-iris", firstModel, "low"],
                        ...(allowed
                          ? [["Bearer fixture-rowan", firstModel, "high"]]
                          : []),
                        ["Bearer fixture-rowan", firstModel, "high"],
                      ]
                    )
                    const first = sent[1].body
                    const context = JSON.stringify(first.messages)
                    assert.ok(
                      context.indexOf(distractor.name) >= 0 &&
                        context.indexOf(distractor.name) <
                          context.indexOf(relevant.name)
                    )
                    for (const def of [distractor, relevant])
                      assert.ok(context.includes(def.description))
                    assert.doesNotMatch(
                      context,
                      /PRIVATE_METHOD|DISTRACTOR_BODY|IRIS_PRIVATE/
                    )
                    assert.ok(!context.includes(skillName))
                    assert.deepEqual(
                      first.tools.map((t) => t.function.name).sort(),
                      [httpName, "read_skill"].sort()
                    )
                    const receipt = recipient.parts[0]
                    assert.ok(
                      receipt.type === "tool-read_skill" &&
                        receipt.state === "output-available"
                    )
                    if (!allowed) {
                      assert.equal(
                        getSkillReadPresentation(receipt, false)?.status,
                        "error"
                      )
                      assert.match(JSON.stringify(recipient), /not assigned/)
                      assert.doesNotMatch(
                        JSON.stringify(recipient),
                        /PRIVATE_METHOD|Measured result|已读取/
                      )
                      assert.equal(sends.length, 0)
                      assert.deepEqual(await run(input), turn)
                      assert.equal(sent.length, 2)
                      continue
                    }
                    const second = sent[2].body
                    const result = second.messages.at(-1)
                    assert.equal(result?.role, "tool")
                    assert.equal(result.tool_call_id, receipt.toolCallId)
                    assert.equal(
                      second.messages.at(-2)?.tool_calls?.[0].id,
                      receipt.toolCallId
                    )
                    assert.deepEqual(
                      second.tools.map((t) => t.function.name),
                      [httpName]
                    )
                    assert.doesNotMatch(
                      JSON.stringify(second.messages),
                      /DISTRACTOR_BODY|IRIS_PRIVATE_SKILL_BODY/
                    )
                    assert.doesNotMatch(
                      JSON.stringify(recipient),
                      /PRIVATE_METHOD|DISTRACTOR_BODY|IRIS_PRIVATE_SKILL_BODY/
                    )
                    const badge = getSkillReadPresentation(receipt, false)
                    assert.equal(
                      result.content,
                      serializeSkillToMarkdown(relevant)
                    )
                    assert.deepEqual(receipt.output, {
                      botId: b,
                      success: true,
                      name: relevant.name,
                      skillId: relevant.id,
                      version: relevant.updatedAt.toISOString(),
                      path: "/skills/" + relevant.name + "/SKILL.md",
                    })
                    assert.equal(
                      badge?.title,
                      "已读取 Skill · " + relevant.name
                    )
                    assert.deepEqual(recipient.parts.at(-1), {
                      type: "text",
                      text: "Measured result: 518",
                      state: "done",
                    })
                    assert.deepEqual(await run(input), turn)
                    assert.equal(sent.length, 3)
                  }
                  requestedSkill = undefined
                  combinedSkill = relevant.name
                  sent = []
                  sends.length = 0
                  const input = user()
                  const turn = await run(input)
                  const [, parent, child] = turn
                  assert.ok(parent.parts.map(getHandoff).some(Boolean))
                  assert.deepEqual(
                    child.parts.map((p) => p.type),
                    ["tool-read_skill", "tool-" + httpName, "text"]
                  )
                  const [skillReceipt, toolReceipt, answer] = child.parts
                  assert.ok("output" in skillReceipt && "output" in toolReceipt)
                  const eid = child.metadata as {
                    executionId: string
                    botId: string
                  }
                  assert.equal(eid.botId, b)
                  assert.notEqual(
                    skillReceipt.toolCallId,
                    toolReceipt.toolCallId
                  )
                  assert.deepEqual(sends, ["/fixture"])
                  assert.ok(observation !== undefined)
                  assert.ok(
                    answer.type === "text" &&
                      answer.text === "Doubled measurement: " + observation * 2
                  )
                  assert.doesNotMatch(
                    JSON.stringify(child.parts),
                    /cohort-cobalt|RAW_MEASUREMENT|PRIVATE_METHOD/
                  )
                  const [, choose, lookup, reply] = sent.map((r) => r.body)
                  assert.doesNotMatch(
                    JSON.stringify(choose),
                    /cohort-cobalt|DISTRACTOR_BODY|PRIVATE_METHOD/
                  )
                  assert.equal(
                    lookup.messages.at(-1)?.content,
                    serializeSkillToMarkdown(relevant)
                  )
                  assert.equal(
                    lookup.messages.at(-1)?.tool_call_id,
                    skillReceipt.toolCallId
                  )
                  assert.deepEqual(
                    lookup.tools.map((t) => t.function.name),
                    [httpName]
                  )
                  assert.equal(
                    reply.messages.at(-1)?.tool_call_id,
                    toolReceipt.toolCallId
                  )
                  assert.equal(
                    JSON.parse(String(reply.messages.at(-1)?.content)).data
                      .value,
                    observation
                  )
                  assert.deepEqual(
                    reply.tools.map((t) => t.function.name),
                    ["record_project_decision"]
                  )
                  const requests = await db
                    .select()
                    .from(modelRequests)
                    .where(eq(modelRequests.executionId, eid.executionId))
                    .orderBy(modelRequests.step)
                  assert.deepEqual(
                    requests.map((r) => [
                      r.botId,
                      r.step,
                      r.model,
                      r.connection,
                      r.effort,
                      r.httpStatus,
                    ]),
                    [0, 1, 2].map((step) => [
                      b,
                      step,
                      firstModel,
                      cb.slice(-8),
                      "high",
                      200,
                    ])
                  )
                  assert.deepEqual(await run(input), turn)
                  assert.equal(sent.length, 4)
                  assert.equal(sends.length, 1)
                  await catalogTest.test(
                    "the recipient records its own observation and replays the saved message without dispatch",
                    async () => {
                      saveMeasurement = true
                      sends.length = 0
                      sent = []
                      const request = user()
                      const saved = await run(request)
                      const recipient = saved[2]
                      assert.deepEqual(
                        recipient.parts.map((p) => p.type),
                        [
                          "tool-read_skill",
                          "tool-" + httpName,
                          "tool-record_project_decision",
                          "text",
                        ]
                      )
                      const receipt = recipient.parts[2]
                      assert.ok("output" in receipt)
                      const result = getToolPresentation(receipt, false)
                      assert.deepEqual(result.memory?.evidence.fields, [
                        { path: "/value", value: observation },
                      ])
                      assert.equal(result.memory?.sourceMessageId, recipient.id)
                      assert.equal(
                        result.memory?.evidence.toolCallId,
                        "fixture-call-0-" + httpName
                      )
                      assert.equal(
                        result.memory?.evidence.executionId,
                        (recipient.metadata as { executionId: string })
                          .executionId
                      )
                      const last = sent.at(-1)!.body
                      assert.equal(
                        last.messages.at(-1)?.tool_call_id,
                        receipt.toolCallId
                      )
                      assert.equal(last.tools?.length ?? 0, 0)
                      const stored = JSON.parse(
                        String(last.messages.at(-1)?.content)
                      )
                      assert.deepEqual(recipient.parts[3], {
                        type: "text",
                        text: stored.decision + " · " + stored.id,
                        state: "done",
                      })
                      assert.doesNotMatch(
                        JSON.stringify(recipient.parts),
                        /RAW_MEASUREMENT|cohort-cobalt/
                      )
                      assert.deepEqual(await run(request), saved)
                      assert.equal(sent.length, 5)
                      assert.deepEqual(sends, ["/fixture"])
                    }
                  )
                } finally {
                  saveMeasurement = false
                  combinedSkill = undefined
                  requestedSkill = undefined
                  await db.batch([
                    db.delete(botSkills).where(inArray(botSkills.skillId, ids)),
                    db.delete(skills).where(inArray(skills.id, ids)),
                  ])
                }
              }
            )
            const [original] = await db
              .select()
              .from(toolDefinitions)
              .where(eq(toolDefinitions.id, httpId))
            const extras = ["_other", "_iris"].map((suffix) => ({
              ...original,
              id: nanoid(),
              name: httpName + suffix,
              config: {
                ...original.config,
                url: "https://example.org/" + suffix,
              },
            }))
            try {
              await db.insert(toolDefinitions).values(extras)
              await db
                .insert(botTools)
                .values(
                  extras.map((def, i) => ({ botId: i ? a : b, toolId: def.id }))
                )
              for (const mode of ["bound", "forbidden", "revoked"] as const) {
                await groupTest.test(
                  "recipient HTTP tool: " + mode,
                  async () => {
                    lookupMode = mode
                    pilotResponse = "success"
                    sample = undefined
                    sends.length = 0
                    sent = []
                    const input = user()
                    const turn = await run(input)
                    const [, source, recipient] = turn
                    assert.ok(source.parts.map(getHandoff).some(Boolean))
                    assert.deepEqual(
                      sent[0].body.tools.map((t) => t.function.name),
                      ["handoff", projectRecallTool]
                    )
                    assert.deepEqual(
                      sent[1].body.tools.map((t) => t.function.name).sort(),
                      [httpName, extras[0].name].sort()
                    )
                    const receipts = recipient.parts.filter(
                      (p) => p.type === "tool-" + httpName && "output" in p
                    )
                    assert.deepEqual(
                      sends,
                      mode === "bound" ? ["/fixture"] : []
                    )
                    if (mode === "forbidden") {
                      assert.equal(receipts.length, 0)
                      assert.equal(sent.length, 2)
                    } else {
                      assert.equal(receipts.length, 1)
                      const receipt = receipts[0]
                      assert.ok("output" in receipt && "input" in receipt)
                      assert.deepEqual(receipt.input, {})
                      assert.equal(
                        receipt.toolCallId,
                        "fixture-call-0-" + httpName
                      )
                      assert.deepEqual(
                        (receipt.output as { kind: string }).kind,
                        "shared-http"
                      )
                      assert.equal(
                        (receipt.output as { success: boolean }).success,
                        mode === "bound"
                      )
                      assert.equal(
                        (receipt.output as { botId: string }).botId,
                        b
                      )
                      assert.equal(recipient.parts.at(-1)?.type, "text")
                      assert.match(
                        JSON.stringify(recipient.parts.at(-1)),
                        mode === "bound"
                          ? new RegExp(sample!)
                          : /binding or tool definition changed/
                      )
                      assert.doesNotMatch(
                        JSON.stringify(recipient),
                        /PRIVATE_RAW_DETAIL|PRIVATE_LOOKUP_THOUGHT|PRIVATE_LOOKUP_ARGUMENT|Unverified value/
                      )
                      assert.deepEqual(
                        sent
                          .slice(1)
                          .map((r) => [r.key, r.body.reasoning.effort]),
                        [
                          ...(mode === "bound"
                            ? [["Bearer fixture-rowan", "high"]]
                            : []),
                          ["Bearer fixture-rowan", "high"],
                        ]
                      )
                      assert.equal(sent[2]?.body.tools?.length ?? 0, 0)
                      const eid = (
                        recipient.metadata as { executionId: string }
                      ).executionId
                      const attempts = await db
                        .select()
                        .from(modelRequests)
                        .where(eq(modelRequests.executionId, eid))
                        .orderBy(modelRequests.step)
                      assert.deepEqual(
                        attempts.map((r) => [r.botId, r.step, r.httpStatus]),
                        [
                          [b, 0, 200],
                          ...(mode === "bound" ? [[b, 1, 200]] : []),
                        ]
                      )
                    }
                    const modelCalls = sent.length
                    assert.deepEqual(await run(input), turn)
                    assert.equal(sent.length, modelCalls)
                    assert.equal(sends.length, mode === "bound" ? 1 : 0)
                  }
                )
              }
            } finally {
              lookupMode = undefined
              await db
                .insert(botTools)
                .values({ botId: b, toolId: httpId })
                .onConflictDoNothing()
              const extraIds = extras.map((x) => x.id)
              await db.batch([
                db.delete(botTools).where(inArray(botTools.toolId, extraIds)),
                db
                  .delete(toolDefinitions)
                  .where(inArray(toolDefinitions.id, extraIds)),
              ])
            }
          } finally {
            pilotResponse = undefined
            await unlink(groupFlag)
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
