import { resolveBotModel } from "../lib/bot-model.server"
import {
  chatMemberChoice,
  validateChoice,
} from "../lib/model-connections.server"
import {
  claimExecution,
  finishExecution,
  hydrateExecutions,
} from "../lib/bot-execution.server"
import {
  authorMetadata,
  publicModelHistory,
  executionInstructions,
  mergeExecutionMessages,
  type Delegation,
} from "../lib/bot-execution"
import { portableHistory } from "../lib/openrouter-step.server"
import { ModelConnectionError } from "../lib/model-credentials.server"
import { chat, defaultStorage, type ChatStreamText } from "@trigger.dev/sdk/ai"
import {
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  type ModelMessage,
  isStepCount,
  tool,
  type ToolSet,
} from "ai"
import { z } from "zod"

import {
  getChatBotMemories,
  getChatSkillBindings,
  getChatToolBindings,
  claimToolPost,
  getTriggerChatContext,
  type TriggerBot,
} from "./bot"
import { resolveReplyBot } from "../lib/chat-bot-context"
import { botTextTransform } from "../lib/chat-bot-text"
import {
  decisionInput,
  projectContextForSteps,
  projectDecisionTool,
} from "../lib/project-decisions"
import { projectEvidence } from "../lib/project-evidence"
import {
  readProjectDecisions,
  recordProjectDecision,
} from "../lib/project-decisions.server"

import { pastRead, skillTurn } from "../lib/bot-skill-turn"

import {
  historyHttpTools,
  httpToolTurn,
  redactToolInputs,
} from "../lib/bot-http-tools"

const decisionDefinition = {
  description:
    "Save an adopted project research decision with an exact quotation from a labeled public group message. Returns its database record ID.",
  inputSchema: decisionInput,
  contextSchema: z.object({ botId: z.string() }),
}
const pastDecision = tool({
  ...decisionDefinition,
  toModelOutput: () => ({
    type: "text",
    value:
      "Historical project decision activity. Consult the current active project records.",
  }),
})

const readSkillInput = z.object({
  name: z
    .string()
    .min(1)
    .describe("Exact identifier from your current skill catalog."),
})
const readSkillDefinition = {
  description: "Read an assigned shared skill's SKILL.md for the current task.",
  inputSchema: readSkillInput,
  contextSchema: z.object({ botId: z.string() }),
}
const readSkillSchema = tool({
  ...readSkillDefinition,
  toModelOutput: () => ({ type: "text", value: pastRead }),
})

const handoffDescription =
  "Pass the user's request to another bot in this group chat when that bot is clearly better suited to answer it."

const handoffInputSchema = z.object({
  botName: z
    .string()
    .min(1)
    .describe(
      "The exact name of the group member who should answer next. Do not use an internal id."
    ),
  reason: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The concrete public task for the recipient, with the requested deliverable. Only include information intended for the group."
    ),
})

const handoffToolSchema = tool({
  description: handoffDescription,
  inputSchema: handoffInputSchema,
})

export const chatAgent = chat.agent({
  id: "chat-agent",
  storage: defaultStorage,
  telemetry: { recordUserMessage: false, recordClientData: false },
  clientDataSchema: z.object({
    botId: z.string().min(1).optional(),
  }),
  tools: async ({ chatId }): Promise<ToolSet> => {
    const chatContext = await getTriggerChatContext(chatId)

    const schemas = historyHttpTools(await getChatToolBindings(chatId))
    if (chatContext?.kind !== "group") {
      return { ...schemas, read_skill: readSkillSchema }
    }

    return {
      ...schemas,
      handoff: handoffToolSchema,
      [projectDecisionTool]: pastDecision,
      read_skill: readSkillSchema,
    }
  },
  run: async ({ chatId, clientData, signal, streamText, ctx, messages }) => {
    await runBotTurn({
      chatId,
      requestedBotId: clientData?.botId,
      signal,
      streamText,
      runId: ctx.run.id,
      messages,
      transcript: chat.history.all(),
      saveHistory: (history) => chat.history.set(history),
      publish: async (stream, parentExecutionId) => {
        if (parentExecutionId)
          return chat.forwardSubAgent(stream, { toolCallId: parentExecutionId })
        const [wire, capture] = stream.tee()
        const collect = async () => {
          let last: UIMessage | undefined
          for await (const m of readUIMessageStream({ stream: capture }))
            last = m
          return last
        }
        const [, message] = await Promise.all([
          chat.pipe(wire, { signal }),
          collect(),
        ])
        return message
      },
    })
  },
})

type BotTurn = {
  chatId: string
  requestedBotId?: string
  runId: string
  signal: AbortSignal
  streamText: ChatStreamText
  messages: ModelMessage[]
  transcript: UIMessage[]
  publish: (
    stream: ReadableStream<UIMessageChunk>,
    parentExecutionId: string | null
  ) => Promise<UIMessage | undefined>
  saveHistory: (history: UIMessage[]) => void
}

// The Trigger adapter owns the session transport. Each call to perform below
// owns its model loop, permissions, public transcript and durable message.
export async function runBotTurn({
  chatId,
  requestedBotId,
  runId,
  signal,
  streamText,
  messages,
  transcript,
  publish,
  saveHistory,
}: BotTurn) {
  const context = await getTriggerChatContext(chatId)
  if (!context) throw new Error("Chat not found")
  const first = resolveReplyBot(context, requestedBotId)
  const history = await hydrateExecutions(chatId, transcript)
  const user = history.findLast((m) => m.role === "user")
  if (!user) throw new Error("The task message is missing.")
  const group = context.kind === "group"
  const members = context.bots

  const completed: UIMessage[] = []
  const perform = async (bot: TriggerBot, incoming: Delegation | null) => {
    const claim = await claimExecution(chatId, user.id, bot.id, runId, incoming)
    const execution = claim.row
    if (!claim.claimed) {
      if (execution.message) completed.push(execution.message)
      return !incoming && execution.status === "completed"
        ? execution.delegation
        : null
    }
    const meta = authorMetadata(execution)
    const options = {
      generateMessageId: () => execution.messageId,
      messageMetadata: () => meta,
      onError: safeError,
    }
    let delegation: Delegation | null = null
    let intent: { target: TriggerBot; task: string } | undefined
    let failure: string | undefined
    let final: UIMessage | undefined
    try {
      signal.throwIfAborted()
      const [modelForStep, skills, bindings, memories, decisions] =
        await Promise.all([
          resolveBotModel(chatId, bot.id, runId, execution.id),
          getChatSkillBindings(chatId, bot.id),
          getChatToolBindings(chatId, { botId: bot.id }),
          getChatBotMemories(chatId, bot.id),
          group ? readProjectDecisions(chatId) : [],
        ])
      const visibleHistory = incoming
        ? mergeExecutionMessages(history, completed)
        : history
      const evidence = group
        ? projectEvidence(chatId, visibleHistory, members)
        : null
      const skill = skillTurn(skills)
      const http = httpToolTurn(
        bindings,
        async (botId, toolId) =>
          (await getChatToolBindings(chatId, { botId, toolId }))[0],
        (toolId, hash) => claimToolPost(chatId, user.id, toolId, hash)
      )
      const project = projectContextForSteps(decisions, () =>
        readProjectDecisions(chatId)
      )
      const committed = new Set<string>()
      const canDelegate = group && !incoming
      const tools = Object.assign({}, http.tools, {
        read_skill: tool({
          ...readSkillDefinition,
          execute: ({ name }, { toolCallId }) =>
            skill.read(bot.id, name, toolCallId),
          toModelOutput: ({ toolCallId, output }) => ({
            type: "text",
            value: output.success
              ? (skill.content(toolCallId) ?? pastRead)
              : output.message,
          }),
        }),
        ...(evidence && {
          [projectDecisionTool]: tool({
            ...decisionDefinition,
            execute: async (input) => {
              const receipt = await recordProjectDecision(
                chatId,
                bot.id,
                evidence.sources,
                input
              )
              if (receipt.success) committed.add(receipt.id)
              return receipt
            },
          }),
        }),
        ...(canDelegate && {
          handoff: tool({
            description: handoffDescription,
            inputSchema: handoffInputSchema,
            execute: async ({ botName, reason }) => {
              const matches = members.filter(
                (m) =>
                  m.name.toLocaleLowerCase() ===
                  botName.trim().toLocaleLowerCase()
              )
              const target = matches.length === 1 ? matches[0] : null
              if (!target || target.id === bot.id)
                return {
                  success: false,
                  message: "Choose another identified member of this group.",
                }
              try {
                await validateChoice(await chatMemberChoice(chatId, target.id))
              } catch (error) {
                return {
                  success: false,
                  message: target.name + ": " + safeError(error),
                }
              }
              if (intent)
                return {
                  success: false,
                  message:
                    "A delegation has already been accepted for this turn.",
                }
              signal.throwIfAborted()
              intent = { target, task: reason }
              return {
                success: true,
                handedOffFrom: { id: bot.id, name: bot.name },
                handedOffTo: { id: target.id, name: target.name },
                reason,
              }
            },
          }),
        }),
      })
      const ownTools = http.names(bot.id)
      const scope = (allowDecision: boolean) => ({
        activeTools: Object.keys(tools).filter(
          (name) => allowDecision || name !== projectDecisionTool
        ),
        toolsContext: {
          ...Object.fromEntries(
            Object.keys(http.tools).map((k) => [k, { botId: bot.id }])
          ),
          read_skill: { botId: bot.id },
          [projectDecisionTool]: { botId: bot.id },
        },
      })
      const instructions = executionInstructions({
        bot,
        context,
        incoming,
        canDelegate,
        memories,
        catalog: skill.catalog(bot.id),
        ownTools,
      })
      const publicInput = evidence
        ? await publicModelHistory(
            evidence.labelHistory(visibleHistory),
            members,
            bot.id
          )
        : portableHistory(messages)
      const initial = modelForStep(0)
      const result = streamText({
        ...initial,
        system: instructions,
        messages: publicInput,
        tools,
        ...scope(true),
        abortSignal: signal,
        stopWhen: [isStepCount(6), () => !!intent],
        experimental_transform: [
          botTextTransform(members),
          redactToolInputs(
            new Set([...Object.keys(http.tools), projectDecisionTool])
          ),
        ],
        onError: ({ error }) => {
          failure = safeError(error)
        },
        prepareStep: async ({ steps }) => {
          const saved = steps.some((s) =>
            s.toolResults.some(
              (r) =>
                r.toolName === projectDecisionTool &&
                (r.output as { success?: boolean } | null)?.success
            )
          )
          return {
            ...(steps.length ? modelForStep(steps.length) : initial),
            instructions: [
              instructions,
              group ? await project(steps.length) : "",
              saved && canDelegate
                ? "The decision is committed. If a delegation was requested, call handoff now."
                : "",
              skill.hasRead(bot.id)
                ? "Follow your retrieved skill's exact procedure and required wording in the visible answer."
                : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
            ...scope(!saved),
          }
        },
      })
      const stream = result.toUIMessageStream(options).pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            if (chunk.type !== "error") {
              controller.enqueue(chunk)
              return
            }
            failure = chunk.errorText
            for (const part of errorParts(failure)) controller.enqueue(part)
          },
        })
      )
      final = await publish(stream, execution.parentExecutionId)
      if (intent && !failure && !signal.aborted) {
        // Parallel tools in the final step have now committed. Resolve evidence
        // references on the server before the recipient can claim its execution.
        const records = await readProjectDecisions(chatId)
        const { target, task } = intent
        delegation = {
          chatId,
          userMessageId: user.id,
          parentExecutionId: execution.id,
          from: { id: bot.id, name: bot.name },
          to: { id: target.id, name: target.name },
          task,
          evidence: records
            .filter(
              (d) =>
                committed.has(d.id) ||
                task.includes(d.id) ||
                user.parts.some(
                  (p) => p.type === "text" && p.text.includes(d.id)
                )
            )
            .map((d) => ({
              decisionId: d.id,
              messageId: d.sourceMessageId,
              part: d.sourcePart,
            })),
        }
      }
    } catch (error) {
      const errorMessage = safeError(error)
      failure = errorMessage
      if (!signal.aborted && !final) {
        const stream = new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({
              type: "start",
              messageId: execution.messageId,
              messageMetadata: meta,
            })
            for (const part of errorParts(errorMessage))
              controller.enqueue(part)
            controller.enqueue({ type: "finish" })
            controller.close()
          },
        })
        final = await publish(stream, execution.parentExecutionId)
      }
    } finally {
      const status = signal.aborted
        ? "cancelled"
        : failure
          ? "failed"
          : "completed"
      const message: UIMessage = {
        id: execution.messageId,
        role: "assistant",
        metadata: meta,
        parts: final?.parts?.length
          ? final.parts
          : [
              {
                type: "text",
                text: signal.aborted
                  ? "Response stopped."
                  : (failure ?? "No response received."),
              },
            ],
      }
      await finishExecution(
        execution.id,
        status,
        message,
        delegation ?? incoming
      )
      completed.push(message)
    }
    return delegation
  }
  try {
    const packet = await perform(first, null)
    if (packet) {
      const target = members.find((member) => member.id === packet.to.id)
      await perform(
        target ?? { ...packet.to, job: "Former member", instructions: null },
        packet
      )
    }
  } finally {
    saveHistory(
      await hydrateExecutions(
        chatId,
        mergeExecutionMessages(history, completed)
      )
    )
  }
}

function safeError(error: unknown) {
  return error instanceof ModelConnectionError
    ? error.message
    : "The bot could not complete its execution. Check its model connection and try again."
}
function errorParts(text: string): UIMessageChunk[] {
  return [
    { type: "text-start", id: "execution-error" },
    { type: "text-delta", id: "execution-error", delta: text },
    { type: "text-end", id: "execution-error" },
  ]
}
