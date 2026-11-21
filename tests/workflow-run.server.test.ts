import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { nanoid } from "nanoid"
import { eq, inArray } from "drizzle-orm"
import {
  digest,
  measureSubset,
  orderedPair,
  subsetExecutionPlan,
  verifyReview,
} from "../lib/workflow-subset"

import { editableNode, nodeBotIds, workflowBotIds, workflowDraftSchema } from "../lib/workflow-draft"

test("nodes retain stable assignments across save and reload, including namesakes and legacy steps", () => {
  const a = nanoid(), b = nanoid()
  const first = editableNode({ id: nanoid(), botId: a, instructions: "Measure", position: { x: 11, y: 17 } }, [{id: a, name: "Ada"}])
  const task = { ...first, title: "Verify", id: nanoid(), instructions: "@Ada @Ada @Ada",
    mentions: [b, a, b].map((value, i) => ({kind: "bot" as const, value, label: "Ada", start: i*5, end:i*5+4})).reverse() }
  const graph = { nodes: [task, first], edges: [{ source: first.id, target: task.id }], viewport: { x: 0, y: 0, zoom: 1 } }
  const saved = workflowDraftSchema.parse(JSON.parse(JSON.stringify(graph)))
  assert.deepEqual(saved, graph)
  assert.deepEqual(nodeBotIds(task), [b,a])
  assert.deepEqual(workflowBotIds(graph), [b,a])
  assert.equal(subsetExecutionPlan(saved)[1].instructions, "@Ada（你） @Ada @Ada（你）")
  assert.deepEqual(subsetExecutionPlan(saved).map(s => [s.stage, s.botId]), [[1,a],[2,b],[2,a]])
  assert.equal(workflowDraftSchema.safeParse({...graph, nodes:[{...task, instructions:"edited"}, first]}).success, false)
  const unassigned = {...task, mentions:[]}
  assert.equal(workflowDraftSchema.safeParse({...graph, nodes:[unassigned,first]}).success, true)
  assert.throws(() => subsetExecutionPlan({...graph, nodes:[unassigned,first]}), /assigned nodes/)
})

const sample = {
  sample: "one",
  split: "holdout",
  stratum: "12 views",
  reference: [0, 2],
  baseline: [1, 3],
  candidate: [0, 2],
}
const bytes = (cases: (typeof sample)[]) =>
  Buffer.from(
    JSON.stringify({
      source: "Synthetic test",
      baseline: "B",
      candidate: "C",
      cases,
    })
  )
test("paired RMSE records the split, input digest and both errors; rejects leakage and unequal arrays", () => {
  const input = bytes([sample])
  const result = measureSubset(input)
  assert.ok(result.evidence.includes(digest(input)))
  assert.ok(
    result.summary.includes("| holdout | 12 views | 1 | 1.000000 | 0.000000 |")
  )
  assert.throws(
    () =>
      measureSubset(
        bytes([
          sample,
          { ...sample, split: "development", stratum: "24 views" },
        ])
      ),
    /across splits/
  )
  assert.throws(
    () => measureSubset(bytes([{ ...sample, candidate: [0] }])),
    /dimensions/
  )
})

test("a lower stratum mean can include both a regression and a tie; a review must identify the measured regression", () => {
  const { review } = measureSubset(
    bytes([
      sample,
      { ...sample, sample: "worse", candidate: [1.5, 3.5] },
      { ...sample, sample: "tie", candidate: sample.baseline },
    ])
  )
  const finding = {
    improvedStrata: 1,
    improvedPairs: 1,
    worsenedPairs: 1,
    tiedPairs: 1,
    witness: {
      sample: "worse",
      split: "holdout",
      stratum: "12 views",
      baseline: 1,
      candidate: 1.5,
    },
    decision: "expand",
  }
  const report = (change: object) =>
    verifyReview(
      JSON.stringify({ ...finding, ...change }),
      review,
      "outputs/original.md"
    )
  assert.match(report({}).text, /worse.*1\.000000.*1\.500000/)
  assert.throws(
    () => report({ improvedPairs: 3, witness: null }),
    /Verification failed/
  )
  assert.throws(
    () => report({ witness: { ...finding.witness, candidate: 0.5 } }),
    /Verification failed/
  )
  assert.throws(
    () =>
      report({ witness: { ...finding.witness, sample: "tie", candidate: 1 } }),
    /Verification failed/
  )
})

test(
  "multi-bot task nodes in a pinned two-step run survive a rejected request, reopen their real report and replay without duplicate calls",
  {
    skip:
      !process.env.DATABASE_URL ||
      process.env.SCIENTISTFLOW_MODEL_DB_TEST !== "1",
    timeout: 120_000,
  },
  async () => {
    const originalDir = process.cwd()
    const root = await mkdtemp(path.join(tmpdir(), "scientistflow-workflow-"))
    const chatId = nanoid(),
      templateId = nanoid(),
      v1 = nanoid(),
      connectionId = nanoid(),
      secondConnectionId = nanoid()
    const owner = nanoid(),
      botIds = [nanoid(), nanoid(), nanoid()]
    const oldOwner = process.env.SCIENTISTFLOW_INSTALLATION_ID
    const originalFetch = globalThis.fetch
    const gateway = "http://127.0.0.1:18218/v1"
    const brief = "Compare the fixed subset for project " + chatId
    const roster = botIds.map((id,i) => ({id, name:"Fixture " + i}))
    const stages = [[0, 1], [2, 0]]
    const steps = stages.map((members, i) => {
      const instructions = "v1-step-" + i + " " + members.map(index => "@" + roster[index].name).join(" ")
      return {
        id: nanoid(), title: i === 0 ? "Measure" : "Review", instructions, position: {x:i, y:0},
        mentions: members.map(index => {
          const bot = roster[index]
          const start = instructions.indexOf("@" + bot.name)
          return {kind: "bot" as const, value: bot.id, label: bot.name, start, end: start + 1 + bot.name.length}
        })
      }
    })
    const graph = { nodes: [steps[1],steps[0]], edges: [{source: steps[0].id, target: steps[1].id}], viewport:{ x:0,y:0,zoom:1 } }
    assert.deepEqual(orderedPair(graph),steps)
    const taskDir = path.join(root, chatId)
    await mkdir(path.join(taskDir, "outputs"), { recursive: true })
    await mkdir(path.join(taskDir, "data"))
    await writeFile(path.join(taskDir, "data/subset.json"), bytes([sample]))
    await writeFile(
      path.join(root, "workspace.local.json"),
      JSON.stringify({ bindings: { [chatId]: { taskDir } } })
    )
    const { db } = await import("../lib/db")
    const {
      bots,
      chatMembers,
      chats,
      chatTurns,
      modelConnections,
      modelRequests,
      taskTemplates,
      taskTemplateVersions,
      botExecutions,
    } = await import("../db/schema")
    const prompts: string[] = []
    try {
      process.chdir(root)
      process.env.SCIENTISTFLOW_INSTALLATION_ID = owner
      const { startWorkflow, runWorkflow, enqueueReviewCorrection } =
        await import("../lib/workflow-run.server")
      const { getChat } = await import("../queries/chats")
      const { textEventResponse } = await import("../lib/chat-live.server")
      const { applyTextFrame } = await import("../lib/chat-live")
      const experimentGate = Promise.withResolvers<void>()
      const reviewGate = Promise.withResolvers<void>()
      const reviewStarted = Promise.withResolvers<void>()
      const firstText = Promise.withResolvers<void>()
      const { chatSnapshot, turnProgress, leaseChatTurn, settleTurn } =
        await import("../lib/chat-jobs.server")
      await db.batch([
        db.insert(modelConnections).values(
          [connectionId, secondConnectionId].map((id) => ({
            id,
            owner,
            revision: nanoid(),
            nickname: "Workflow test",
            baseUrl: gateway,
            provider: "gateway" as const,
            state: "ready" as const,
            catalog: [
              {
                id: "fixture",
                name: "Fixture",
                efforts: [],
                unavailable: null,
              },
            ],
          }))
        ),
        db.insert(bots).values(
          botIds.map((id, i) => ({
            id,
            name: "Fixture " + i,
            job: "Workflow test",
            modelChoice: { connectionId, modelId: "fixture", effort: null },
          }))
        ),
        db
          .insert(taskTemplates)
          .values({ id: templateId, name: "Test workflow" }),
        db.insert(taskTemplateVersions).values(
          [1, 2].map((n) => ({
            id: n === 1 ? v1 : nanoid(),
            templateId,
            version: n,
            draftRevision: n,
            name: "Test workflow",
            workflow:
              n === 1
                ? graph
                : {
                    ...graph,
                    nodes: steps.map((s) => ({
                      ...s,
                      instructions: "V2-ONLY",
                    })),
                  },
          }))
        ),
        db.insert(chats).values({
          id: chatId,
          nativeOwner: owner,
          kind: "group",
          templateVersionId: v1,
          researchBrief: brief,
        }),
        db
          .insert(chatMembers)
          .values(botIds.map((botId) => ({ chatId, botId }))),
      ])
      globalThis.fetch = async (url, init) => {
        if (String(url) !== gateway + "/chat/completions")
          return originalFetch(url, init)
        const prompt = JSON.stringify(JSON.parse(String(init?.body)).messages)
        prompts.push(prompt)
        assert.ok(prompt.includes(brief))
        assert.ok(!prompt.includes("V2-ONLY"))
        if (prompts.length === 1)
          return Response.json(
            { error: { message: "Daily quota" } },
            { status: 429 }
          )
        assert.ok(
          prompt.includes(prompts.length <= 3 ? "v1-step-0" : "v1-step-1")
        )
        assert.ok(prompt.includes("1.000000 | 0.000000"))
        if (prompts.length === 3) assert.ok(prompt.includes("First participant " + chatId))
        if (prompts.length >= 4) assert.ok(prompt.includes("Mira report unique to " + chatId))
        const answer =
          prompts.length === 2
            ? "First participant " + chatId
            : prompts.length === 3 ? "Mira report unique to " + chatId
            : JSON.stringify({
                improvedStrata: 1,
                improvedPairs: 1,
                worsenedPairs: 0,
                tiedPairs: 0,
                witness: null,
                decision: "insufficient",
              })
        const event = (delta: object, finish_reason: string | null) =>
          "data: " +
          JSON.stringify({
            id: "completion",
            object: "chat.completion.chunk",
            model: "fixture",
            created: 1,
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n"
        const gate = prompts.length === 2 ? experimentGate : prompts.length === 4 ? reviewGate : undefined
        if (prompts.length === 4) reviewStarted.resolve()
        const cut = Math.min(8, answer.length)
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode(event({ role: "assistant", content: answer.slice(0, cut) }, null)))
              if (gate) await gate.promise
              controller.enqueue(encoder.encode(event({ content: answer.slice(cut) }, null) + event({}, "stop") + "data: [DONE]\n\n"))
              controller.close()
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        )
      }
      const chat = (await getChat(chatId))!
      const [first, duplicate] = await Promise.all([
        startWorkflow(chat),
        startWorkflow(chat),
      ])
      assert.equal(first.turnId, duplicate.turnId)
      const run = async (expectedFailure: boolean) => {
        const lease = nanoid(),
          job = (await leaseChatTurn(lease))!
        assert.equal(job.chatId, chatId)
        const workflow = (
          job.userMessage.metadata as {
            workflow: Parameters<typeof runWorkflow>[2]
          }
        ).workflow
        const work = runWorkflow(
          chatId,
          job.id,
          workflow,
          lease,
          new AbortController().signal,
          job.replies
        )
        if (expectedFailure) await assert.rejects(work, /429/)
        else await work
        await settleTurn(
          lease,
          job.replies,
          expectedFailure
            ? "HTTP 429. Available after " +
                new Date(Date.now() + 3600000).toISOString() +
                "."
            : null
        )
      }
      await run(true)
      assert.equal((await startWorkflow(chat)).state, "failed")
      await assert.rejects(
        startWorkflow(chat, true),
        /daily limit still applies/
      )
      await db
        .update(bots)
        .set({
          modelChoice: {
            connectionId: secondConnectionId,
            modelId: "fixture",
            effort: null,
          },
        })
        .where(eq(bots.id, botIds[0]))
      await startWorkflow(chat, true)
      const subscription = new AbortController()
      const live = textEventResponse(chatId, first.turnId, subscription.signal)
      const visible = new Map<string, import("../lib/chat-live").LiveText>()
      const frames = (async () => {
        const reader = live.body!.getReader()
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          const data = new TextDecoder().decode(value)
          if (!data.startsWith("data: ")) continue
          const frame = JSON.parse(data.slice(6))
          const text = applyTextFrame(visible.get(frame.id), frame)!
          visible.set(frame.id, text)
          if (text.text === "First pa") firstText.resolve()
        }
      })()
      const running = run(false)
      try {
        await Promise.race([firstText.promise, running.then(() => { throw Error("Missing live prefix") })])
        const active = await turnProgress(chatId, first.turnId)
        assert.equal(active.workingStep?.stage, 1)
        assert.equal(active.workingStep?.botId, botIds[0])
        assert.equal(active.replies.length, 0)
        experimentGate.resolve()
        await Promise.race([reviewStarted.promise, running.then(() => { throw Error("Missing review") })])
        const review = await turnProgress(chatId, first.turnId)
        assert.equal(review.workingStep?.stage, 2)
        assert.equal(review.workingStep?.botId, botIds[2])
        assert.equal(review.workingStep?.draft, undefined)
        assert.equal(review.replies.length, 2)
        reviewGate.resolve()
        await running
      } finally {
        experimentGate.resolve()
        reviewGate.resolve()
        subscription.abort()
        await frames
        await running
      }
      assert.deepEqual([...visible.values()].map(draft => draft.text), ["First participant " + chatId, "Mira report unique to " + chatId])
      assert.equal((await turnProgress(chatId, first.turnId)).workingStep, null)
      const before = await chatSnapshot(chatId)
      assert.deepEqual(
        before.messages.map((m) => m.role),
        ["user", "assistant", "assistant", "assistant", "assistant"]
      )
      for (const message of before.messages.slice(1)) {
        const meta = message.metadata as {
          versionId: string
          artifact: { path: string; sha256: string; evidence: string }
        }
        assert.equal(meta.versionId, v1)
        assert.match(meta.artifact.path, /^outputs\/docs\/(subset|review)-[^/]+\.md$/)
        assert.equal(
          digest(await readFile(path.join(taskDir, meta.artifact.path))),
          meta.artifact.sha256
        )
      }
      assert.equal((await startWorkflow(chat, true)).state, "completed")
      assert.deepEqual(await chatSnapshot(chatId), before)
      assert.equal(await leaseChatTurn(nanoid()), undefined)
      assert.equal(prompts.length, 5)
      const executions = await db
        .select()
        .from(botExecutions)
        .where(eq(botExecutions.chatId, chatId))
        .orderBy(botExecutions.slot)
      assert.deepEqual(
        executions.map((e) => e.botId),
        stages.flat().map(index => botIds[index])
      )
      assert.deepEqual(executions.slice(1).map(e => e.parentExecutionId), executions.slice(0,-1).map(e => e.id))
      assert.deepEqual(before.messages.slice(1).map(m => (m.metadata as {workflowStep: number}).workflowStep), [1,1,2,2])
      assert.equal(
        (await db.select().from(chatTurns).where(eq(chatTurns.chatId, chatId)))
          .length,
        1
      )
      const model = {
        connectionId: secondConnectionId,
        modelId: "fixture",
        effort: null,
      }
      const receipt = await enqueueReviewCorrection(chat, model)
      await run(false)
      const after = await chatSnapshot(chatId)
      assert.deepEqual(
        after.messages.slice(0, before.messages.length),
        before.messages
      )
      assert.equal(after.messages.length, before.messages.length + 2)
      const corrected = after.messages.at(-1)!
      assert.equal(
        (corrected.metadata as { supersedesExecutionId: string })
          .supersedesExecutionId,
        executions[2].id
      )
      assert.equal(
        (corrected.metadata as { parentExecutionId: string }).parentExecutionId,
        executions[1].id
      )
      assert.equal(
        (
          await enqueueReviewCorrection(chat, {
            effort: model.effort,
            modelId: model.modelId,
            connectionId: model.connectionId,
          })
        ).turnId,
        receipt.turnId
      )
      assert.equal(await leaseChatTurn(nanoid()), undefined)
      assert.equal(prompts.length, 6)
      const logNames = await readdir(path.join(taskDir, "logs"))
      const logs = await Promise.all(logNames.map(name => readFile(path.join(taskDir, "logs", name), "utf8")))
      assert.equal(logs.filter(log => log.includes("Status: failed")).length, 1)
      assert.equal(logs.filter(log => log.includes("Status: completed")).length, 5)
      for (const message of after.messages.filter(m => m.role === "assistant")) {
        const {artifact} = message.metadata as { artifact: { path: string; sha256: string } }
        assert.equal(logs.filter(log => log.includes("Report: " + artifact.path) && log.includes(artifact.sha256)).length, 1)
      }
      const correctionRequests = await db
        .select()
        .from(modelRequests)
        .where(
          eq(
            modelRequests.executionId,
            (corrected.metadata as { executionId: string }).executionId
          )
        )
      assert.deepEqual(
        correctionRequests.map((r) => [r.botId, r.connection]),
        [[botIds[2], secondConnectionId.slice(-8)]]
      )
    } finally {
      globalThis.fetch = originalFetch
      process.chdir(originalDir)
      if (oldOwner === undefined)
        delete process.env.SCIENTISTFLOW_INSTALLATION_ID
      else process.env.SCIENTISTFLOW_INSTALLATION_ID = oldOwner
      await db.batch([
        db.delete(modelRequests).where(eq(modelRequests.chatId, chatId)),
        db.delete(chats).where(eq(chats.id, chatId)),
        db.delete(taskTemplates).where(eq(taskTemplates.id, templateId)),
        db.delete(bots).where(inArray(bots.id, botIds)),
        db
          .delete(modelConnections)
          .where(
            inArray(modelConnections.id, [connectionId, secondConnectionId])
          ),
      ])
      await rm(root, { recursive: true, force: true })
    }
  }
)
