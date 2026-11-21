import assert from "node:assert/strict"
import { randomInt } from "node:crypto"
import { Readable } from "node:stream"
import test from "node:test"
import { nanoid } from "nanoid"
import { eq, inArray } from "drizzle-orm"
import {
  bots,
  chats,
  chatMembers,
  botExecutions,
  projectDecisions,
} from "../db/schema"
import { httpToolTurn } from "../lib/bot-http-tools"
import { toolEvidenceRef } from "../lib/tool-result-evidence"
import { getToolPresentation } from "../lib/chat-presentation"

test(
  "verified tool calls survive a lost receipt and deduplicate by observation, including when independent measurements agree",
  {
    skip:
      process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1"
        ? "未启用数据库集成测试"
        : !process.env.DATABASE_URL?.trim() && "缺少 DATABASE_URL",
  },
  async (t) => {
    const { db } = await import("../lib/db")
    const {
      readProjectDecisions,
      recordToolProjectDecision,
      withdrawProjectDecision,
    } = await import("../lib/project-decisions.server")
    const [chatId, otherChat, botId, executionId, messageId, toolId] =
      Array.from({ length: 6 }, () => nanoid())
    const scope = { chatId, botId, executionId, messageId }
    const bound = {
      botId,
      botName: "Observer",
      id: toolId,
      name: "measure",
      displayName: "Measure",
      description: "Observe a value",
      kind: "http" as const,
      config: {
        method: "GET" as const,
        url: "https://example.org/measurement",
        auth: { type: "none" as const },
      },
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    try {
      await db.batch([
        db.insert(bots).values({ id: botId, name: "Observer", job: "Test" }),
        db
          .insert(chats)
          .values(
            [chatId, otherChat].map((id) => ({ id, kind: "group" as const }))
          ),
        db
          .insert(chatMembers)
          .values([chatId, otherChat].map((chatId) => ({ chatId, botId }))),
        db.insert(botExecutions).values({
          ...scope,
          id: executionId,
          slot: 1,
          status: "running",
          parentExecutionId: nanoid(),
          runId: nanoid(),
          userMessageId: nanoid(),
        }),
      ])
      let value = 0,
        sends = 0,
        status = 200
      const measurementTurn = (identity: typeof scope, sample: () => number) =>
        httpToolTurn(
          [bound],
          async () => bound,
          async () => true,
          async () => {
            sends++
            value = sample()
            return {
              status,
              contentType: "application/json",
              body: Readable.from([
                JSON.stringify({
                  samples: [{ value, unit: "ms" }],
                  token: "private-test-token",
                }),
              ]),
            }
          },
          () => identity
        )
      const turn = measurementTurn(scope, () => randomInt(20, 10000))
      async function observe(callId: string, meter = turn, identity = scope) {
        const tool = meter.tools.measure
        const output = await tool.execute!(
          {},
          { toolCallId: callId, messages: [], context: identity }
        )
        const result = await tool.toModelOutput!({
          input: {},
          toolCallId: callId,
          output,
        })
        assert.ok(result.type === "text")
        return output.success
          ? (JSON.parse(result.value).evidenceRef as string)
          : undefined
      }
      const first = await observe("http-one")
      const source = await observe("http-two")
      assert.ok(first && source && first !== source)
      const sampled = value
      const fields = [
        { path: "/samples/0/value", value: String(sampled) },
        { path: "/samples/0/unit", value: "ms" },
      ]
      const input = {
        source,
        fields,
        decision: "Latency measured " + sampled + " ms",
      }
      const save = (changes: Partial<typeof input> = {}) =>
        recordToolProjectDecision(scope, turn.observation, {
          ...input,
          ...changes,
        })
      for (const mismatch of [
        { chatId: otherChat },
        { executionId: nanoid() },
        { botId: nanoid() },
        { messageId: nanoid() },
      ]) {
        assert.equal(
          (
            await recordToolProjectDecision(
              { ...scope, ...mismatch },
              turn.observation,
              input
            )
          ).success,
          false
        )
      }
      assert.equal(
        (
          await recordToolProjectDecision(
            scope,
            () => turn.observation(first),
            input
          )
        ).success,
        false
      )
      for (const field of [
        { path: "/samples/0/value", value: "-1" },
        { path: "/wrong", value: "ms" },
        { path: "/token", value: "[redacted]" },
      ])
        assert.equal((await save({ fields: [field] })).success, false)
      status = 500
      assert.equal(await observe("failed"), undefined)
      assert.equal(
        (
          await save({
            source: toolEvidenceRef({ ...scope, toolCallId: "failed" }),
          })
        ).success,
        false
      )
      assert.equal((await readProjectDecisions(chatId)).length, 0)
      const [one, two] = await Promise.all([
        save(),
        save({ decision: "Another wording of the same observation" }),
      ])
      assert.ok(one.success && two.success)
      assert.deepEqual(one, two)
      const committed = await readProjectDecisions(chatId)
      assert.deepEqual(
        committed.map((r) => [r.id, r.toolEvidence?.toolCallId]),
        [[one.id, "http-two"]]
      )
      const cold = await recordToolProjectDecision(
        scope,
        () => undefined,
        input
      )
      assert.deepEqual(cold, one)
      // A historical receipt for this exact tool already exists. Neither
      // another group nor a new execution can use it as a fresh observation.
      for (const other of [
        { ...scope, chatId: otherChat },
        { ...scope, executionId: nanoid(), messageId: nanoid() },
      ]) {
        const replay = await recordToolProjectDecision(
          other,
          () => undefined,
          input
        )
        assert.equal(replay.success, false)
      }
      const fabricated = await recordToolProjectDecision(
        scope,
        () => undefined,
        { ...input, fields: [{ path: "/samples/0/value", value: "999999" }] }
      )
      assert.equal(fabricated.success, false)
      const rows = await readProjectDecisions(chatId)
      assert.equal(rows.length, 1)
      assert.deepEqual(rows[0].toolEvidence?.fields, [
        { path: fields[0].path, value: sampled },
        { path: fields[1].path, value: "ms" },
      ])
      assert.equal(rows[0].decision, one.decision)
      assert.equal(rows[0].id, one.id)
      assert.equal(rows[0].toolEvidence?.toolCallId, "http-two")
      assert.equal(sends, 3)
      assert.deepEqual(await readProjectDecisions(otherChat, one.id), [])
      const receipt = getToolPresentation(
        {
          type: "tool-record_project_decision",
          toolCallId: "save",
          state: "output-available",
          input: {},
          output: one,
        },
        false
      )
      assert.equal(receipt.memory?.sourceMessageId, messageId)
      assert.deepEqual(receipt.memory?.evidence, rows[0].toolEvidence)

      // A separate experiment can yield the same value and conclusion.
      const repeat = { ...scope, executionId: nanoid(), messageId: nanoid() }
      await db.insert(botExecutions).values({
        ...repeat,
        id: repeat.executionId,
        slot: 1,
        status: "running",
        parentExecutionId: nanoid(),
        runId: nanoid(),
        userMessageId: nanoid(),
      })
      status = 200
      const secondTurn = measurementTurn(repeat, () => sampled)
      const secondSource = await observe(
        "independent-measure",
        secondTurn,
        repeat
      )
      assert.ok(secondSource && secondSource !== source)
      const repeatInput = {
        ...input,
        source: secondSource,
        decision: one.decision,
      }
      // The real transaction commits before the application loses the acknowledgement.
      const batch = db.batch.bind(db)
      const lostReceipt = t.mock.method(
        db,
        "batch",
        async (...args: Parameters<typeof db.batch>) => {
          await batch(...args)
          throw new Error("Dropped commit acknowledgement")
        },
        { times: 1 }
      )
      const second = await recordToolProjectDecision(
        repeat,
        secondTurn.observation,
        repeatInput
      )
      assert.equal(lostReceipt.mock.callCount(), 1)
      assert.ok(second.success)
      assert.notEqual(second.id, one.id)
      assert.deepEqual(second.toolEvidence.fields, one.toolEvidence.fields)
      assert.equal(second.toolEvidence.executionId, repeat.executionId)
      assert.equal(second.toolEvidence.toolCallId, "independent-measure")
      assert.deepEqual(
        await recordToolProjectDecision(repeat, () => undefined, repeatInput),
        second
      )
      assert.equal((await readProjectDecisions(chatId)).length, 2)
      assert.equal(sends, 4)
      assert.ok(await withdrawProjectDecision(chatId, one.id))
      assert.equal((await save()).success, false)
      assert.equal(
        (
          await db
            .select({ id: projectDecisions.id })
            .from(projectDecisions)
            .where(eq(projectDecisions.chatId, chatId))
        ).length,
        2
      )
    } finally {
      await db.batch([
        db.delete(chats).where(inArray(chats.id, [chatId, otherChat])),
        db.delete(bots).where(eq(bots.id, botId)),
      ])
    }
  }
)
