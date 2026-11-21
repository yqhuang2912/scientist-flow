import type {
  LanguageModelV4FunctionTool,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider"
import { parsePartialJson } from "ai"
import { z } from "zod"
import { projectRecallTool } from "./project-decisions"

// A provider output channel, not an executable agent tool. Shared HTTP tool
// identifiers cannot contain a hyphen, so they cannot impersonate this channel.
export const groupReplyOutput: LanguageModelV4FunctionTool = {
  type: "function",
  name: "publish-group-reply",
  description:
    "Deliver an ordinary final answer to the group. Its text is immediately public. Select this alone, only after deciding no more tools or project-memory verification are needed.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
}
export const groupReplyInstructions = `For ordinary replies, including writing or rewriting supplied text, deliver the final Markdown through ${groupReplyOutput.name}. For questions about a previous project conclusion or its evidence, always use ${projectRecallTool} instead (null recordId if no match). Never put a candidate answer into the public reply channel. Select either final channel alone.`

const body = z.strictObject({ text: z.string() })

export class GroupReplyStream {
  private id?: string
  private otherTool = false
  private readonly pendingCalls = new Set<string>()
  private input = ""
  private published = ""
  private finalText?: string

  constructor(private readonly publish: (delta: string) => void) {}

  private append(text: string) {
    if (!text.startsWith(this.published))
      throw new Error("The public reply changed previously emitted text.")
    const delta = text.slice(this.published.length)
    if (delta) this.publish(delta)
    this.published = text
  }

  async consume(part: LanguageModelV4StreamPart) {
    if (part.type === "tool-input-start" || part.type === "tool-call") {
      if (part.toolName !== groupReplyOutput.name) {
        this.otherTool = true
        if (this.id)
          throw new Error("Cannot call a tool after committing a public reply.")
        if (part.type === "tool-input-start") this.pendingCalls.add(part.id)
        else this.pendingCalls.delete(part.toolCallId)
        return false
      }
      const id = part.type === "tool-call" ? part.toolCallId : part.id
      if (
        !id ||
        this.otherTool ||
        (this.id && this.id !== id) ||
        part.providerExecuted
      )
        throw new Error("The public reply must be the only call in its step.")
      this.id = id
      if (part.type === "tool-call") {
        const { text } = body.parse(JSON.parse(part.input))
        if (
          !text.trim() ||
          (this.finalText !== undefined && this.finalText !== text)
        )
          throw new Error("Invalid final reply.")
        this.finalText = text
      }
      return true
    }
    if (part.type === "tool-input-delta" && part.id === this.id) {
      this.input += part.delta
      const { value } = await parsePartialJson(this.input)
      const partial = body.safeParse(value)
      // The JSON parser may have decoded just the high half of a surrogate pair.
      if (partial.success)
        this.append(partial.data.text.replace(/[\uD800-\uDBFF]$/u, ""))
      return true
    }
    return false
  }

  finish(reason: string | undefined) {
    // A provider can close a stream without assembling its tool arguments.
    // Even a trailing "stop" cannot promote that call's preamble to an answer.
    if (this.pendingCalls.size) throw new Error("Incomplete group tool call.")
    if (!this.id) return
    if (
      this.finalText === undefined ||
      (reason !== "stop" && reason !== "tool-calls")
    )
      throw new Error("The public reply did not finish.")
    this.append(this.finalText)
    return this.finalText
  }
}
