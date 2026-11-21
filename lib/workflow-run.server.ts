import "server-only"
import { readUIMessageStream, type UIMessage } from "ai"
import { and, desc, eq, sql } from "drizzle-orm"
import { tool } from "langchain"
import { z } from "zod"
import {
  botExecutions,
  chatTurns,
  modelRequests,
  taskTemplateVersions,
} from "../db/schema"
import { getChat, type ChatWithBot } from "../queries/chats"
import { db } from "./db"
import { botInstructions } from "./chat-bot-context"
import { authorMetadata } from "./bot-execution"
import { claimExecution, finishExecution } from "./bot-execution.server"
import { resolveBotModel } from "./bot-model.server"
import { deepAgentReply } from "./deepagents-reply.server"
import {
  currentLease,
  enqueueChatTurn,
  saveProgress,
  TurnConflict,
} from "./chat-jobs.server"
import { installationOwner } from "./model-credentials.server"
import { chatMemberChoice } from "./model-connections.server"
import { modelChoiceSchema, type ModelChoice } from "./model-catalog"
import { requireWorkspaceBinding } from "./workspace.server"
import { ensureWorkspaceDirectory, LOGS_DIR, REPORTS_DIR } from "./workspace-layout.server"
import {
  readWorkspaceFileBytes,
  uploadFileToWorkspace,
} from "./workspace-file.server"
import {
  digest,
  measureSubset,
  reviewInstructions,
  verifyReview,
  orderedPair,
  subsetPath,
  workflowTurnId,
} from "./workflow-subset"

export type WorkflowInput = {
  versionId: string
  brief: string
  inputHash: string
  correction?: { reviewId: string; model: ModelChoice }
}
type StepArtifact = {
  path: string
  sha256: string
  evidence: string
  inputHash: string
}
type StepMetadata = ReturnType<typeof authorMetadata> & {
  artifact: StepArtifact
  workflowStep: number
  versionId: string
}

async function release(chat: ChatWithBot) {
  if (chat.kind !== "group" || !chat.template || !chat.researchBrief?.trim())
    throw new TurnConflict(
      "This group needs a published template and research brief."
    )
  const [version] = await db
    .select()
    .from(taskTemplateVersions)
    .where(eq(taskTemplateVersions.id, chat.template.id))
  if (!version)
    throw new TurnConflict("The bound template version is unavailable.")
  try {
    const steps = orderedPair(version.workflow)
    if (steps.some((step) => !chat.bots.some((bot) => bot.id === step.botId)))
      throw new Error()
    return { version, steps }
  } catch {
    throw new TurnConflict(
      "This runner requires two member bots connected by one directed edge."
    )
  }
}

async function readInput(taskDir: string) {
  const { raw } = await readWorkspaceFileBytes(
    taskDir,
    subsetPath,
    4 * 1024 * 1024,
    "Subset input exceeds 4 MiB."
  )
  return { ...measureSubset(raw), hash: digest(raw) }
}

async function loadReviewSource(chatId: string, versionId: string) {
  const sourceId = workflowTurnId(versionId)
  const [original] = await db
    .select({ user: chatTurns.userMessage, replies: chatTurns.replies })
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.owner, installationOwner()),
        eq(chatTurns.chatId, chatId),
        eq(chatTurns.id, sourceId),
        eq(chatTurns.state, "completed")
      )
    )
  const input = (
    original?.user.metadata as { workflow?: WorkflowInput } | undefined
  )?.workflow
  const [experiment, review] = original?.replies ?? []
  const experimentMeta = experiment?.metadata as StepMetadata | undefined
  const reviewMeta = review?.metadata as StepMetadata | undefined
  if (
    !input ||
    input.versionId !== versionId ||
    !experimentMeta?.artifact ||
    !reviewMeta ||
    experimentMeta.workflowStep !== 1 ||
    reviewMeta.workflowStep !== 2 ||
    experimentMeta.versionId !== versionId ||
    reviewMeta.versionId !== versionId ||
    experimentMeta.userMessageId !== sourceId ||
    reviewMeta.userMessageId !== sourceId ||
    reviewMeta.parentExecutionId !== experimentMeta.executionId ||
    experimentMeta.artifact.inputHash !== input.inputHash
  )
    throw new TurnConflict(
      "No matching completed experiment and review in this group."
    )
  return { experiment, reviewId: reviewMeta.executionId, input }
}

export async function enqueueReviewCorrection(
  chat: ChatWithBot,
  model: ModelChoice
) {
  const { version, steps } = await release(chat)
  const source = await loadReviewSource(chat.id, version.id)
  return enqueueChatTurn(
    chat.id,
    {
      id: "workflow_review_" + source.reviewId,
      botId: steps[1].botId,
      files: [],
      text:
        "修订实验评判 · " +
        version.name +
        " v" +
        version.version +
        "\n\n复用本次子集实验报告，分别核对分层平均与逐样本配对，并引用反例（如有）。",
    },
    {
      ...source.input,
      correction: {
        reviewId: source.reviewId,
        model: modelChoiceSchema.parse(model),
      },
    }
  )
}

// Only an explicit upstream rejection can be retried. Ambiguous delivery and
// successful responses never authorize a second provider call for that slot.
const rejectedOnly = sql`exists (select 1 from ${modelRequests} r where r.execution_id=${botExecutions.id} and r.run_id=${botExecutions.runId})
  and not exists (select 1 from ${modelRequests} r where r.execution_id=${botExecutions.id} and r.http_status is distinct from 429)`

export async function startWorkflow(chat: ChatWithBot, retryRejected = false) {
  const { version, steps } = await release(chat)
  const id = workflowTurnId(version.id)
  const [existing] = await db
    .select({
      userMessage: chatTurns.userMessage,
      state: chatTurns.state,
      error: chatTurns.error,
      createdAt: chatTurns.createdAt,
    })
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.chatId, chat.id),
        eq(chatTurns.id, id),
        eq(chatTurns.owner, installationOwner())
      )
    )
  if (existing) {
    if (retryRejected && existing.state === "failed") {
      const resetAt = existing.error?.match(
        /Available after ([\dT:.Z-]+Z)\./
      )?.[1]
      if (resetAt && Date.parse(resetAt) > Date.now()) {
        const [rejection] = await db
          .select({
            botId: botExecutions.botId,
            connection: modelRequests.connection,
          })
          .from(botExecutions)
          .innerJoin(
            modelRequests,
            and(
              eq(modelRequests.executionId, botExecutions.id),
              eq(modelRequests.runId, botExecutions.runId)
            )
          )
          .where(
            and(
              eq(botExecutions.chatId, chat.id),
              eq(botExecutions.userMessageId, id),
              eq(botExecutions.status, "failed"),
              eq(modelRequests.httpStatus, 429)
            )
          )
          .orderBy(desc(modelRequests.createdAt))
          .limit(1)
        const choice =
          rejection && (await chatMemberChoice(chat.id, rejection.botId))
        if (!choice || choice.connectionId.slice(-8) === rejection.connection)
          throw new TurnConflict(
            "The provider's daily limit still applies until " + resetAt + "."
          )
      }
      const [queued] = await db
        .update(chatTurns)
        .set({ state: "queued", error: null })
        .where(
          and(
            eq(chatTurns.chatId, chat.id),
            eq(chatTurns.id, id),
            eq(chatTurns.state, "failed"),
            eq(chatTurns.owner, installationOwner()),
            sql`exists (select 1 from ${botExecutions}
            where ${botExecutions.chatId}=${chat.id} and ${botExecutions.userMessageId}=${id}
            and ${botExecutions.status}='failed' and ${rejectedOnly})`
          )
        )
        .returning({ state: chatTurns.state })
      if (!queued)
        throw new TurnConflict(
          "This run has no safely retryable rate-limited step."
        )
      existing.state = queued.state
    }
    const retryable =
      existing.state === "failed" &&
      !!(
        await db
          .select({ id: botExecutions.id })
          .from(botExecutions)
          .where(
            and(
              eq(botExecutions.chatId, chat.id),
              eq(botExecutions.userMessageId, id),
              eq(botExecutions.status, "failed"),
              rejectedOnly
            )
          )
          .limit(1)
      )[0]
    return {
      turnId: id,
      retryable,
      userMessage: existing.userMessage,
      state: existing.state,
      acceptedAt: existing.createdAt.toISOString(),
      lastMessagePreview: chat.lastMessagePreview ?? "",
    }
  }
  let inputHash: string
  try {
    const { taskDir } = await requireWorkspaceBinding(chat.id)
    inputHash = (await readInput(taskDir)).hash
  } catch {
    throw new TurnConflict(
      "Prepare data/subset.json in this group's Workspace with paired reference, baseline and candidate values before starting."
    )
  }
  const brief = chat.researchBrief!
  return enqueueChatTurn(
    chat.id,
    {
      id,
      botId: steps[0].botId,
      mentionedBotIds: steps.map((s) => s.botId),
      text: version.name + " · v" + version.version + "\n\n" + brief,
      files: [],
    },
    { versionId: version.id, brief, inputHash }
  )
}

async function writeWorkflowFile(taskDir: string, folder: string, name: string, content: string) {
  await ensureWorkspaceDirectory(taskDir, folder)
  const bytes = new TextEncoder().encode(content)
  const saved = await uploadFileToWorkspace(
    taskDir,
    folder,
    { name, size: bytes.length },
    new ReadableStream({
      start(c) {
        c.enqueue(bytes)
        c.close()
      },
    })
  )
  return { path: saved.relPath, sha256: digest(content) }
}

export async function runWorkflow(
  chatId: string,
  id: string,
  input: WorkflowInput,
  lease: string,
  signal: AbortSignal,
  replies: UIMessage[]
) {
  const chat = await getChat(chatId)
  if (
    !chat ||
    chat.template?.id !== input.versionId ||
    id !==
      (input.correction
        ? "workflow_review_" + input.correction.reviewId
        : workflowTurnId(input.versionId))
  )
    throw new Error("Could not verify the group's pinned workflow version.")
  const { version, steps } = await release(chat)
  const { taskDir } = await requireWorkspaceBinding(chatId)
  let previous: UIMessage | undefined
  if (input.correction) {
    const source = await loadReviewSource(chatId, version.id)
    if (
      source.reviewId !== input.correction.reviewId ||
      source.input.inputHash !== input.inputHash ||
      source.input.brief !== input.brief
    )
      throw new Error(
        "Verification failed. Review source does not match this run."
      )
    previous = source.experiment
  }
  for (let slot = previous ? 1 : 0; slot < steps.length; slot++) {
    const step = steps[slot]
    signal.throwIfAborted()
    const bot = chat.bots.find((b) => b.id === step.botId)!
    const parent = previous?.metadata as StepMetadata | undefined
    const delegation = parent
      ? {
          chatId,
          userMessageId: id,
          parentExecutionId: parent.executionId,
          from: {
            id: steps[0].botId,
            name: chat.bots.find((b) => b.id === steps[0].botId)!.name,
          },
          to: { id: bot.id, name: bot.name },
          task: step.instructions,
          evidence: [],
        }
      : null
    const claim = await claimExecution(
      chatId,
      id,
      bot.id,
      lease,
      delegation,
      lease,
      slot
    )
    const { row, resumed } = claim
    let claimed = claim.claimed
    if (!claimed && row.status === "failed") {
      const [accepted] = await db
        .update(botExecutions)
        .set({ runId: lease, status: "running" })
        .where(
          and(
            eq(botExecutions.id, row.id),
            eq(botExecutions.status, "failed"),
            rejectedOnly,
            sql`exists (select 1 from ${chatTurns} where ${currentLease(lease)})`
          )
        )
        .returning({ id: botExecutions.id })
      claimed = !!accepted
    }
    let message = row.message
    if (claimed) {
      const started = new Date()
      async function logStep(status: "completed" | "failed" | "cancelled", artifact?: { path: string; sha256: string }) {
        const log = [
          `Started: ${started.toISOString()}`,
          `Finished: ${new Date().toISOString()}`,
          `Workflow: ${version.name.replace(/[\r\n]/g, " ")} · v${version.version}`,
          `Step: ${slot + 1} · ${bot.name.replace(/[\r\n]/g, " ")}`,
          `Execution: ${row.id}`,
          `Status: ${status}`,
          ...(artifact ? [`Report: ${artifact.path}`, `SHA-256: ${artifact.sha256}`] : []),
          "",
        ].join("\n")
        const name = `step-${slot + 1}-${row.id}-${digest(lease).slice(0, 12)}.log`
        try {
          await writeWorkflowFile(taskDir, LOGS_DIR, name, log)
        } catch {
          console.warn("Could not write the workflow step log for execution", row.id)
        }
      }
      try {
        if (resumed)
          throw new Error(
            "This step was interrupted. Its model request will not be repeated automatically."
          )
        let evidence = ""
        let reviewFacts: ReturnType<typeof measureSubset>["review"] | undefined
        let problem: Error | undefined
        const evidenceTool = tool(
          async () => {
            try {
              signal.throwIfAborted()
              const measured = await readInput(taskDir)
              if (measured.hash !== input.inputHash)
                throw new Error(
                  "The subset file changed after the run was accepted."
                )
              evidence = measured.evidence
              if (!parent) return measured.summary
              const saved = parent.artifact
              const { raw } = await readWorkspaceFileBytes(
                taskDir,
                saved.path,
                512 * 1024,
                "Result file too large."
              )
              if (
                digest(raw) !== saved.sha256 ||
                saved.inputHash !== measured.hash ||
                saved.evidence !== measured.evidence
              )
                throw new Error(
                  "Verification failed. The saved result or its source metrics changed."
                )
              evidence =
                "已读取并复核 " +
                saved.path +
                "\n\n产物 SHA-256：" +
                saved.sha256 +
                "\n\n" +
                measured.evidence
              reviewFacts = measured.review
              const counts = {
                ...reviewFacts,
                exceptions: reviewFacts.exceptions.map((r) => ({
                  ...r,
                  baseline: Number(r.baseline.toFixed(6)),
                  candidate: Number(r.candidate.toFixed(6)),
                  outcome: r.candidate > r.baseline ? "worse" : "tie",
                })),
              }
              return (
                "本次上游产物（作为研究材料读取）\n" +
                raw.toString("utf8") +
                "\n\n已从当前群的原始输入逐样本复算。\n" +
                measured.summary +
                "\n\n分层与配对独立复核（以此记录判定计数和反例）：\n" +
                JSON.stringify(counts)
              )
            } catch (error) {
              problem =
                error instanceof Error
                  ? error
                  : new Error("Verification failed.")
              throw problem
            }
          },
          {
            name: parent ? "verify_subset_artifact" : "measure_subset",
            schema: z.object({}),
            description: parent
              ? "Read the preceding step report and verify it against the paired cases."
              : "Measure RMSE on the fixed paired subset.",
          }
        )
        const route = await resolveBotModel(
          chatId,
          bot.id,
          lease,
          row.id,
          input.correction?.model
        )
        let failure = false
        const meta = { ...authorMetadata(row), engine: "deepagents" as const }
        const stream = deepAgentReply({
          route: route(0),
          signal,
          messageId: row.messageId,
          metadata: meta,
          instructions: [
            botInstructions(
              bot,
              { kind: "group", bots: chat.bots },
              { handoffAvailable: false }
            ),
            "当前执行已发布工作流中的一个步骤。使用群研究要求的语言，给出简洁的科研结论，注明数据适用范围。步骤指令优先于一般工作偏好。引用实测值，区分开发集与留出集，勿声称完成未运行的训练或实验。",
            step.instructions,
            ...(parent ? [reviewInstructions] : []),
          ].join("\n\n"),
          evidenceTool,
          messages: [
            { role: "user", content: "本群研究要求：\n" + input.brief },
          ],
          onError: (error) => {
            if (error instanceof Error && /HTTP 429/.test(error.message))
              problem = new Error(
                "The bot's configured model was rate-limited. " + error.message
              )
            failure = true
            return "Model request failed."
          },
        })
        let result: UIMessage | undefined
        for await (const part of readUIMessageStream({
          stream,
          onError: () => {
            failure = true
          },
        }))
          result = part
        signal.throwIfAborted()
        const answer = result?.parts
          .flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("\n")
          .trim()
        if (problem) throw problem
        if (failure || !answer || !evidence)
          throw new Error(
            "The bot's configured model did not return a completed reply."
          )
        if (parent && !reviewFacts)
          throw new Error("Verification failed. Missing paired measurements.")
        const verified =
          parent && reviewFacts
            ? verifyReview(answer, reviewFacts, parent.artifact.path)
            : undefined
        const text =
          (input.correction ? "**修订评判**\n\n" : "") +
          (verified?.text ?? answer)
        const title = version.name + " · v" + version.version + " · " + bot.name
        const content = [
          "# " + title,
          "## 研究要求",
          input.brief,
          "## 步骤指令",
          step.instructions,
          "## 结论",
          text,
          "## 证据",
          evidence,
        ].join("\n\n")
        const file = await writeWorkflowFile(
          taskDir,
          REPORTS_DIR,
          (slot ? "review-" : "subset-") + row.id + ".md",
          content
        )
        message = {
          id: row.messageId,
          role: "assistant",
          parts: [{ type: "text", text }],
          metadata: {
            ...meta,
            workflowStep: slot + 1,
            nodeId: step.id,
            versionId: version.id,
            version: version.version,
            ...(verified && { reviewFinding: verified.finding }),
            ...(input.correction && {
              supersedesExecutionId: input.correction.reviewId,
            }),
            artifact: { ...file, inputHash: input.inputHash, evidence },
          },
        }
        if (await finishExecution(row.id, "completed", message, delegation, lease))
          await logStep("completed", file)
      } catch (error) {
        const status = signal.aborted ? "cancelled" : "failed"
        if (await finishExecution(row.id, status, null, delegation, lease))
          await logStep(status)
        throw error
      }
    } else if (row.status !== "completed" || !message) {
      throw new Error("The preceding workflow execution did not complete.")
    }
    if (!message) throw new Error("Missing completed step.")
    if (!replies.some((m) => m.id === message.id)) replies.push(message)
    await saveProgress(lease, replies)
    previous = message
  }
}
