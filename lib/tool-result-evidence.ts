import { createHash } from "node:crypto"
import type { z } from "zod"
import type { ToolEvidence, toolDecisionInput } from "./project-decisions"

export type EvidenceScope = {
  chatId: string
  botId: string
  executionId: string
  messageId: string
}
export type ToolObservation = EvidenceScope &
  Omit<ToolEvidence, "fields"> & { data: unknown }

export function toolEvidenceRef(
  s: EvidenceScope & Pick<ToolEvidence, "toolCallId">
) {
  return (
    "T-" +
    createHash("sha256")
      .update(
        JSON.stringify([
          s.chatId,
          s.botId,
          s.executionId,
          s.messageId,
          s.toolCallId,
        ])
      )
      .digest("hex")
  )
}

export function snapshotToolEvidence(
  scope: EvidenceScope,
  source: ToolObservation,
  input: z.infer<typeof toolDecisionInput>
): ToolEvidence | { error: string } {
  if (
    source.chatId !== scope.chatId ||
    source.botId !== scope.botId ||
    source.executionId !== scope.executionId ||
    source.messageId !== scope.messageId ||
    toolEvidenceRef(source) !== input.source
  )
    return {
      error: "The evidence does not match this execution's HTTP result.",
    }
  const fields: ToolEvidence["fields"] = []
  for (const { path, value } of input.fields) {
    const field = "Field " + (fields.length + 1)
    if (/~(?![01])/.test(path) || fields.some((f) => f.path === path))
      return { error: field + " needs a distinct, valid JSON Pointer." }
    let node = source.data
    for (const encoded of path.slice(1).split("/")) {
      const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~")
      if (
        !key ||
        /^(?:__proto__|constructor|prototype|authorization|proxy-authorization|cookie|set-cookie|(?:access|refresh|id)[_-]?token|token|api[_-]?key|client[_-]?secret|password|private[_-]?key)$/i.test(
          key
        ) ||
        !node ||
        typeof node !== "object" ||
        !Object.hasOwn(node, key) ||
        (Array.isArray(node) && !/^(0|[1-9]\d*)$/.test(key))
      )
        return {
          error:
            field +
            " does not resolve to a public field inside data. Start the pointer at the contents of data, without a /data prefix.",
        }
      node = (node as Record<string, unknown>)[key]
    }
    if (
      (typeof node !== "string" &&
        typeof node !== "number" &&
        typeof node !== "boolean") ||
      String(node) !== value ||
      node === "[redacted]"
    )
      return {
        error:
          field +
          " must match the exact scalar value from the HTTP result. Copy the original digits or string without formatting.",
      }
    fields.push({ path, value: node })
  }
  const { executionId, toolCallId, toolId, toolName, digest } = source
  return { executionId, toolCallId, toolId, toolName, digest, fields }
}
