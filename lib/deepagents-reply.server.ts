import "server-only"
import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages"
import { createDeepAgent, registerHarnessProfile } from "deepagents"
import { createMiddleware } from "langchain"
import type { ModelMessage, UIMessageChunk } from "ai"
import type { resolveBotModel } from "./bot-model.server"
import { ModelConnectionError } from "./model-credentials.server"

type Route = ReturnType<Awaited<ReturnType<typeof resolveBotModel>>>
const profile = "scientistflow:direct-text"
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

// The agent invokes this model once. The resolved provider keeps ownership of
// credential selection, wire validation and the provider's completion receipt.
class DirectTextModel extends BaseChatModel {
  readonly modelName = profile
  private called = false
  constructor(
    private readonly route: Route,
    private readonly signal: AbortSignal,
    private readonly onText: (delta: string) => void
  ) {
    super({ maxRetries: 0, cache: false })
  }
  _llmType() {
    return "scientistflow-direct-text"
  }
  bindTools(tools: unknown[]) {
    if (tools.length)
      throw new Error("Tools are disabled for the direct text pilot.")
    return this
  }
  async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"]) {
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.signal])
      : this.signal
    signal.throwIfAborted()
    if (this.called)
      throw new Error("Only one model call is permitted per direct reply.")
    this.called = true
    const prompt: Parameters<Route["model"]["doStream"]>[0]["prompt"] =
      messages.map((message) => {
        const text = message.text
        if (SystemMessage.isInstance(message))
          return { role: "system" as const, content: text }
        const role = HumanMessage.isInstance(message)
          ? "user"
          : AIMessage.isInstance(message)
            ? "assistant"
            : null
        if (!role) throw new Error("Unexpected role in the text pilot.")
        return { role, content: [{ type: "text" as const, text }] }
      })
    const { stream } = await this.route.model.doStream({
      prompt,
      providerOptions: this.route.providerOptions,
      abortSignal: signal,
    })
    let text = "",
      complete = false
    const reader = stream.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        signal.throwIfAborted()
        if (value.type === "error") throw value.error
        if (value.type.startsWith("tool-"))
          throw new Error("Unexpected tool output.")
        if (value.type === "finish")
          complete = value.finishReason.unified === "stop"
        if (value.type === "text-delta") {
          text += value.delta
          this.onText(value.delta)
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    signal.throwIfAborted()
    if (!complete || !text.trim())
      throw new ModelConnectionError("The model did not complete a text reply.")
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
    if (!text.trim()) return []
    return [
      message.role === "user" ? new HumanMessage(text) : new AIMessage(text),
    ]
  })
}

export function deepAgentReply(options: {
  route: Route
  instructions: string
  messages: ModelMessage[]
  signal: AbortSignal
  messageId: string
  metadata: { executionId: string; engine?: "deepagents" }
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
      const model = new DirectTextModel(options.route, signal, (delta) => {
        if (!started) {
          write({ type: "text-start", id })
          started = true
        }
        write({ type: "text-delta", id, delta })
      })
      try {
        const agent = createDeepAgent({
          model,
          systemPrompt: options.instructions,
          tools: [],
          subagents: [],
          checkpointer: false,
          middleware: [
            createMiddleware({
              name: "DirectTextOnly",
              wrapModelCall: (request, handler) =>
                handler({
                  ...request,
                  tools: [],
                  systemMessage: new SystemMessage(options.instructions),
                }),
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
          { signal, recursionLimit: 8 }
        )
        if (!started)
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
