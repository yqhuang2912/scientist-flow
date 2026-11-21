import "server-only"
import { isDeepStrictEqual } from "node:util"
import type {
  LanguageModelV4FunctionTool,
  LanguageModelV4FilePart,
  LanguageModelV4Message,
} from "@ai-sdk/provider"
import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import type { StructuredToolInterface } from "@langchain/core/tools"
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages"
import { createDeepAgent, registerHarnessProfile } from "deepagents"
import { createMiddleware, tool } from "langchain"
import {
  asSchema,
  type ModelMessage,
  type ToolSet,
  type UIMessageChunk,
} from "ai"
import { z } from "zod"
import {
  handoffDescription,
  handoffInputSchema,
  type HandoffInput,
} from "./chat-handoff"
import type { resolveBotModel } from "./bot-model.server"
import { ModelConnectionError } from "./model-credentials.server"
import {
  groupReplyInstructions,
  groupReplyOutput,
  GroupReplyStream,
} from "./group-reply-stream"
import {
  type ProjectCitation,
  projectCitationMarkdown,
  projectDecisionMediaType,
  projectDecisionTool,
  projectRecallInput,
  projectRecallTool,
} from "./project-decisions"

type Route = ReturnType<Awaited<ReturnType<typeof resolveBotModel>>>
const profile = "scientistflow:single-turn"
registerHarnessProfile(profile, {
  generalPurposeSubagent: { enabled: false },
  excludedMiddleware: ["SummarizationMiddleware"],
  excludedTools: [
    "task",
    "ls",
    "read_file",
    "write_file",
    "edit_file",
    "delete",
    "glob",
    "grep",
    "execute",
  ],
})

type PilotCall = { id: string; name: string; args: Record<string, unknown> }
const objectInput = z.record(z.string(), z.unknown())

function providerMessage(message: BaseMessage): LanguageModelV4Message {
  if (SystemMessage.isInstance(message))
    return { role: "system", content: message.text }
  if (ToolMessage.isInstance(message) && message.name)
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: message.tool_call_id,
          toolName: message.name,
          output: { type: "text", value: message.text },
        },
      ],
    }
  const text = { type: "text" as const, text: message.text }
  if (HumanMessage.isInstance(message)) {
    const files = message.additional_kwargs.workspaceFiles as
      LanguageModelV4FilePart[] | undefined
    return {
      role: "user",
      content: [...(text.text ? [text] : []), ...(files ?? [])],
    }
  }
  if (AIMessage.isInstance(message))
    return {
      role: "assistant",
      content: [
        ...(text.text ? [text] : []),
        ...(message.tool_calls ?? []).map((c) => ({
          type: "tool-call" as const,
          toolCallId: c.id!,
          toolName: c.name,
          input: c.args,
        })),
      ],
    }
  throw new Error("Unexpected pilot message.")
}

class PilotModel extends BaseChatModel {
  readonly modelName = profile
  private steps = 0
  private call?: PilotCall
  private readonly completedCallIds = new Set<string>()
  constructor(
    private readonly route: Route,
    private readonly signal: AbortSignal,
    private readonly definitions: LanguageModelV4FunctionTool[],
    private readonly followup: ((step: number) => Route) | undefined,
    private readonly allowsTool: (name: string) => boolean,
    private readonly onText: (delta: string) => void,
    private readonly general = false
  ) {
    super({ maxRetries: 0, cache: false })
  }
  _llmType() {
    return "scientistflow-single-turn"
  }
  bindTools(tools: { name?: string }[]) {
    if (tools.some((t) => !this.definitions.some((d) => d.name === t.name)))
      throw new Error("Unexpected pilot tool binding.")
    return this
  }
  async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"]) {
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.signal])
      : this.signal
    signal.throwIfAborted()
    const step = this.steps++
    const last = messages.at(-1)
    if (
      step > 0 &&
      !(
        step <= (this.general ? 5 : 3) &&
        this.followup &&
        this.call &&
        last &&
        ToolMessage.isInstance(last) &&
        this.completedCallIds.has(last.tool_call_id)
      )
    )
      throw new Error("Unexpected pilot model step.")
    const route = step === 0 ? this.route : this.followup!(step)
    const tools = this.definitions.filter((t) => this.allowsTool(t.name))
    const hasRecall = tools.some((t) => t.name === projectRecallTool)
    const groupReply =
      this.general && hasRecall ? new GroupReplyStream(this.onText) : undefined
    const { stream } = await route.model.doStream({
      prompt: messages.map(providerMessage),
      tools: groupReply
        ? [...tools, groupReplyOutput]
        : tools.length
          ? tools
          : undefined,
      providerOptions: route.providerOptions,
      abortSignal: signal,
    })
    let text = ""
    let finish: string | undefined
    const calls = new Map<string, PilotCall>()
    // A recipient may return either an answer or a tool call. Only committed
    // answer text belongs in the public message before the tool result exists.
    const canCite = !this.general && !this.followup && hasRecall
    const bufferText = this.general
      ? hasRecall
      : tools.length > 0 && (!!this.followup || canCite)
    const reader = stream.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        signal.throwIfAborted()
        if (value.type === "error") throw value.error
        if (groupReply && (await groupReply.consume(value))) continue
        if (value.type.startsWith("tool-") && !tools.length)
          throw new Error("Unexpected tool output.")
        // Both provider SDKs assemble argument deltas into this final event.
        // Execute only after a clean terminal frame and validation of the whole call.
        if (value.type === "tool-call") {
          if (
            !tools.some((t) => t.name === value.toolName) ||
            !value.toolCallId ||
            this.completedCallIds.has(value.toolCallId) ||
            value.providerExecuted
          )
            throw new Error("Unexpected pilot tool call.")
          const schema =
            value.toolName === "handoff" ? handoffInputSchema : objectInput
          const next = {
            id: value.toolCallId,
            name: value.toolName,
            args: schema.parse(JSON.parse(value.input)),
          }
          const previous = calls.get(next.id)
          if (
            (previous && !isDeepStrictEqual(previous, next)) ||
            (!this.general && calls.size && !previous)
          )
            throw new Error("Only one tool call is permitted.")
          calls.set(next.id, next)
        }
        if (value.type === "finish") finish = value.finishReason.unified
        if (value.type === "text-delta") {
          text += value.delta
          if (!bufferText) this.onText(value.delta)
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    signal.throwIfAborted()
    const publicReply = groupReply?.finish(finish)
    if (publicReply !== undefined)
      return {
        generations: [
          { text: publicReply, message: new AIMessage(publicReply) },
        ],
      }
    const call = calls.values().next().value
    if (call && (finish === "tool-calls" || finish === "stop")) {
      if (
        groupReply &&
        calls.size > 1 &&
        [...calls.values()].some((c) => c.name === projectRecallTool)
      )
        throw new Error("A project citation must be the only call in its step.")
      if (canCite && call.name === "handoff" && text) this.onText(text)
      this.call = call
      for (const id of calls.keys()) this.completedCallIds.add(id)
      return {
        generations: [
          {
            text,
            message: new AIMessage({
              content: text,
              tool_calls: [...calls.values()],
            }),
          },
        ],
      }
    }
    if (finish !== "stop" || !text.trim())
      throw new ModelConnectionError("The model did not complete a text reply.")
    if (bufferText) this.onText(text)
    return { generations: [{ text, message: new AIMessage(text) }] }
  }
}

function publicText(messages: ModelMessage[]) {
  return messages.flatMap((message): (HumanMessage | AIMessage)[] => {
    if (message.role !== "user" && message.role !== "assistant") return []
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n")
    const files: LanguageModelV4FilePart[] = []
    if (message.role === "user" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type !== "file") continue
        // Workspace preparation produces bounded data URLs. Never download a
        // caller-supplied remote URL when rebuilding the public history.
        const data = part.data
        if (
          !data ||
          typeof data !== "object" ||
          !("type" in data) ||
          data.type !== "url"
        )
          throw new Error("Unsupported workspace attachment.")
        const url = String(data.url)
        const match = /^data:[^;,]+;base64,([a-z0-9+/=]+)$/i.exec(url)
        if (!match) throw new Error("Invalid workspace attachment.")
        files.push({
          type: "file",
          mediaType: part.mediaType,
          filename: part.filename,
          data: { type: "data", data: match[1] },
        })
      }
    }
    if (!text.trim() && !files.length) return []
    return [
      message.role === "user"
        ? new HumanMessage({
            content: text,
            additional_kwargs: { workspaceFiles: files },
          })
        : new AIMessage(text),
    ]
  })
}

export function deepAgentReply(options: {
  route: Route
  instructions: string
  stepInstructions?: (step: number) => Promise<string>
  canRecordDecision?: () => boolean
  messages: ModelMessage[]
  signal: AbortSignal
  messageId: string
  metadata: { executionId: string; engine?: "deepagents" }
  general?: boolean
  recipient?: {
    botId: string
    tools: ToolSet
    followup: (step: number) => Route
  }
  handoff?: (
    input: HandoffInput
  ) => Promise<{ success: boolean; message?: string }>
  resolveCitation?: (recordId: string) => Promise<ProjectCitation | undefined>
  onError: (error: unknown) => string
}) {
  const cancel = new AbortController()
  const signal = AbortSignal.any([options.signal, cancel.signal])
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const write = (chunk: UIMessageChunk) => {
        if (!cancel.signal.aborted) controller.enqueue(chunk)
      }
      const id = options.messageId
      let started = false
      const publishText = (delta: string) => {
        if (!started) {
          write({ type: "text-start", id })
          started = true
        }
        write({ type: "text-delta", id, delta })
      }
      try {
        const accept = options.handoff
        let handedOff = false
        let citation: ProjectCitation | undefined
        let rejection: string | undefined
        const recipient = options.recipient
        const definitions: LanguageModelV4FunctionTool[] = []
        if (accept)
          definitions.push({
            type: "function",
            name: "handoff",
            description: handoffDescription,
            inputSchema: await asSchema(handoffInputSchema).jsonSchema,
          })
        let phase: "initial" | "after-skill" | "after-http" | "answer" =
          "initial"
        const allowsTool = (name: string) => {
          if (options.general)
            return (
              name !== projectDecisionTool ||
              options.canRecordDecision?.() !== false
            )
          if (name === projectDecisionTool) return phase === "after-http"
          return (
            phase === "initial" ||
            (phase === "after-skill" && name !== "read_skill")
          )
        }
        let verifiedFailure: string | undefined
        const tools: StructuredToolInterface[] = accept
          ? [
              tool(
                async (input, config) => {
                  const toolCallId = config.toolCall?.id
                  if (!toolCallId)
                    throw new Error("Missing handoff call identity.")
                  signal.throwIfAborted()
                  if (started) {
                    write({ type: "text-end", id })
                    started = false
                  }
                  write({
                    type: "tool-input-available",
                    toolCallId,
                    toolName: "handoff",
                    input,
                  })
                  const output = await accept(input)
                  write({ type: "tool-output-available", toolCallId, output })
                  handedOff = output.success
                  if (!handedOff)
                    rejection = output.message || "Handoff was declined."
                  return JSON.stringify(output)
                },
                {
                  name: "handoff",
                  description: handoffDescription,
                  schema: handoffInputSchema,
                  returnDirect: true,
                }
              ),
            ]
          : await Promise.all(
              Object.entries(recipient?.tools ?? {}).map(
                async ([name, shared]) => {
                  const description =
                    typeof shared.description === "string"
                      ? shared.description
                      : name
                  definitions.push({
                    type: "function",
                    name,
                    description,
                    inputSchema: await asSchema(shared.inputSchema).jsonSchema,
                  })
                  return tool(
                    async (input, config) => {
                      const toolCallId = config.toolCall?.id
                      if (
                        !recipient ||
                        !toolCallId ||
                        !allowsTool(name) ||
                        !shared.execute
                      )
                        throw new Error("Unexpected recipient tool execution.")
                      signal.throwIfAborted()
                      // Close the gate before awaiting I/O. Only a verified skill
                      // read reopens it, for one subsequent HTTP call.
                      const followingSkill = phase === "after-skill"
                      phase = "answer"
                      write({
                        type: "tool-input-available",
                        toolName: name,
                        toolCallId,
                        input: name === "handoff" ? input : {},
                      })
                      const validated = await asSchema(
                        shared.inputSchema
                      ).validate?.(input)
                      if (validated && !validated.success)
                        throw new Error("Invalid tool input.")
                      const output = await shared.execute(
                        validated?.value ?? input,
                        {
                          toolCallId,
                          context: {
                            botId: recipient.botId,
                            executionId: options.metadata.executionId,
                          },
                          abortSignal: signal,
                          messages: [],
                        }
                      )
                      write({
                        type: "tool-output-available",
                        toolCallId,
                        output,
                      })
                      if (options.general && name === "handoff") {
                        handedOff = output.success === true
                      }
                      if (!shared.toModelOutput) return JSON.stringify(output)
                      const result = await shared.toModelOutput({
                        toolCallId,
                        input,
                        output,
                      })
                      if (result.type !== "text")
                        throw new Error("Expected a text tool result.")
                      if (!options.general && output.success !== true)
                        verifiedFailure = result.value
                      else if (name === "read_skill") phase = "after-skill"
                      else if (followingSkill && output.kind === "shared-http")
                        phase = "after-http"
                      return result.value
                    },
                    {
                      name,
                      description,
                      schema: objectInput,
                    }
                  )
                }
              )
            )
        const resolveCitation = options.resolveCitation
        if (resolveCitation) {
          const description =
            "Select one matching active decision in this project. The server publishes the stored decision and evidence with its source."
          definitions.push({
            type: "function",
            name: projectRecallTool,
            description,
            inputSchema: await asSchema(projectRecallInput).jsonSchema,
          })
          tools.push(
            tool(
              async ({ recordId }) => {
                signal.throwIfAborted()
                citation = recordId
                  ? await resolveCitation(recordId)
                  : undefined
                signal.throwIfAborted()
                const reply = citation
                  ? projectCitationMarkdown(citation)
                  : "No matching active decision was found in this project."
                publishText(reply)
                return reply
              },
              {
                name: projectRecallTool,
                description,
                schema: projectRecallInput,
                returnDirect: true,
              }
            )
          )
        }
        const model = new PilotModel(
          options.route,
          signal,
          definitions,
          recipient?.followup,
          allowsTool,
          (delta) => {
            if (!verifiedFailure) publishText(delta)
          },
          options.general
        )
        let step = 0
        const agent = createDeepAgent({
          model,
          systemPrompt: options.instructions,
          tools,
          subagents: [],
          checkpointer: false,
          middleware: [
            createMiddleware({
              name: "PilotToolScope",
              wrapModelCall: async (request, handler) => {
                if (handedOff) return new AIMessage("")
                if (verifiedFailure) return new AIMessage(verifiedFailure)
                const instructions = options.stepInstructions
                  ? await options.stepInstructions(step++)
                  : options.instructions
                return handler({
                  ...request,
                  tools: tools.filter((tool) => allowsTool(tool.name)),
                  systemMessage: new SystemMessage(
                    options.general && resolveCitation
                      ? instructions + "\n\n" + groupReplyInstructions
                      : instructions
                  ),
                })
              },
            }),
          ],
        })
        signal.throwIfAborted()
        options.metadata.engine = "deepagents"
        write({
          type: "start",
          messageId: id,
          messageMetadata: options.metadata,
        })
        await agent.invoke(
          { messages: publicText(options.messages) },
          // Graph steps include middleware and tool nodes between the
          // model calls. The route and tool gates enforce the actual budgets.
          { signal, recursionLimit: options.general ? 40 : recipient ? 20 : 8 }
        )
        if (verifiedFailure) publishText(verifiedFailure)
        if (citation) {
          write({ type: "text-end", id })
          started = false
          write({
            type: "source-document",
            sourceId: citation.id,
            mediaType: projectDecisionMediaType,
            title: citation.id,
          })
        }
        if (rejection) throw new ModelConnectionError(rejection)
        if (!started && !handedOff && !citation)
          throw new ModelConnectionError("The model returned no public reply.")
      } catch (error) {
        if (!signal.aborted) {
          if (started) write({ type: "text-end", id })
          started = false
          write({ type: "error", errorText: options.onError(error) })
        }
      } finally {
        if (started) write({ type: "text-end", id })
        write(signal.aborted ? { type: "abort" } : { type: "finish" })
        if (!cancel.signal.aborted) controller.close()
      }
    },
    cancel(reason) {
      cancel.abort(reason)
    },
  })
}
