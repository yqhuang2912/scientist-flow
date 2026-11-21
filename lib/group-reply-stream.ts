import type {
  LanguageModelV4FunctionTool,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider"
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

// Only stream the single string in {"text":"…"}. The provider's assembled
// tool-call remains authoritative and is validated even if no deltas arrived.
const openingTokens = {
  object: ["{", "keyStart"],
  keyStart: ['"', "key"],
  colon: [":", "valueStart"],
  valueStart: ['"', "value"],
} as const
type ReplyPhase = keyof typeof openingTokens | "key" | "value" | "done"

const shortEscapes: Readonly<Partial<Record<string, string>>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
}

class ReplyTextDecoder {
  private phase: ReplyPhase = "object"
  private key = ""
  private escape = ""
  private highSurrogate = ""

  read(fragment: string) {
    let decoded = ""
    for (let offset = 0; offset < fragment.length;) {
      if (this.phase === "done") break
      if (this.phase === "value" && !this.escape) {
        const start = offset
        while (offset < fragment.length) {
          const code = fragment.charCodeAt(offset)
          if (code < 32 || code === 34 || code === 92) break
          offset++
        }
        if (offset > start) {
          decoded += fragment.slice(start, offset)
          continue
        }
      }
      let ch = fragment[offset++]
      if (this.phase !== "key" && this.phase !== "value") {
        if (/[ \t\r\n]/.test(ch)) continue
        const [token, next]: readonly [string, ReplyPhase] =
          openingTokens[this.phase]
        this.phase = ch === token ? next : "done"
        continue
      }

      if (this.escape || ch === "\\") {
        this.escape += ch
        if (
          this.escape.length < 2 ||
          (this.escape[1] === "u" && this.escape.length < 6)
        )
          continue
        if (this.escape[1] === "u") {
          const hex = this.escape.slice(2)
          if (!/^[\da-f]{4}$/i.test(hex)) {
            this.phase = "done"
            break
          }
          ch = String.fromCharCode(parseInt(hex, 16))
        } else {
          const value = shortEscapes[this.escape[1]]
          if (value === undefined) {
            this.phase = "done"
            break
          }
          ch = value
        }
        this.escape = ""
      } else if (ch === '"') {
        this.phase =
          this.phase === "key" && this.key === "text" ? "colon" : "done"
        continue
      } else if (ch < " ") {
        this.phase = "done"
        break
      }

      if (this.phase === "key") {
        this.key += ch
        if (!"text".startsWith(this.key)) this.phase = "done"
      } else {
        decoded += ch
      }
    }

    const text = this.highSurrogate + decoded
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) {
      this.highSurrogate = text.slice(-1)
      return text.slice(0, -1)
    }
    this.highSurrogate = ""
    return text
  }
}

export class GroupReplyStream {
  private id?: string
  private otherTool = false
  private readonly pendingCalls = new Set<string>()
  private readonly decoder = new ReplyTextDecoder()
  private readonly published: string[] = []
  private finalText?: string

  constructor(private readonly publish: (delta: string) => void) {}

  private emit(delta: string) {
    if (!delta) return
    this.publish(delta)
    this.published.push(delta)
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
      this.emit(this.decoder.read(part.delta))
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
    const prefix = this.published.join("")
    if (!this.finalText.startsWith(prefix))
      throw new Error("The public reply changed previously emitted text.")
    this.emit(this.finalText.slice(prefix.length))
    return this.finalText
  }
}
