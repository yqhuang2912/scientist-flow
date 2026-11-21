import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai"
import { projectDecisionTool, toolEvidenceSchema } from "./project-decisions"

export type ChatPart = UIMessage["parts"][number]
export type ChatToolPart = ToolUIPart | DynamicToolUIPart
export type IndexedChatPart = { part: ChatPart; index: number }
export type ChatSpeaker = {
  id: string
  name: string
  job: string
  avatar: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function getMessageBotId(message: UIMessage): string | null {
  const botId = record(message.metadata)?.botId
  return typeof botId === "string" ? botId : null
}

// Only expose the handoff's public identity and reason, never its instructions.
export function getHandoff(part: ChatPart) {
  if (
    !isToolUIPart(part) ||
    getToolName(part) !== "handoff" ||
    part.state !== "output-available"
  )
    return null

  const output = record(part.output)
  const target = record(output?.handedOffTo)
  const source = record(output?.handedOffFrom)
  if (output?.success !== true || typeof target?.name !== "string") return null

  return {
    sourceName: typeof source?.name === "string" ? source.name : null,
    sourceId: typeof source?.id === "string" ? source.id : null,
    targetId: typeof target.id === "string" ? target.id : null,
    targetName: target.name,
    reason: typeof output.reason === "string" ? output.reason : null,
  }
}

export function getAssistantSegments(
  message: UIMessage,
  fallbackBotId: string | null,
  includePending = false
) {
  if (typeof record(message.metadata)?.executionId === "string") {
    return [
      {
        key: message.id,
        botId: getMessageBotId(message),
        parts: message.parts.map((part, index) => ({ part, index })),
      },
    ]
  }
  // Stream metadata ends with the recipient's id. Earlier parts still belong
  // to the sender, so derive the starting identity from the handoff result.
  const firstHandoff = message.parts.map(getHandoff).find(Boolean)
  let speakerId =
    firstHandoff?.sourceId ?? getMessageBotId(message) ?? fallbackBotId
  const segments: {
    key: string
    botId: string | null
    parts: IndexedChatPart[]
  }[] = []
  let current = {
    key: `${message.id}:0`,
    botId: speakerId,
    parts: [] as IndexedChatPart[],
  }

  let nextSpeaker: string | null = null
  message.parts.forEach((part, index) => {
    // Calls in the handoff step still run as the sender. Older transcripts
    // can omit step-start, in which case the next prose begins the reply.
    if (nextSpeaker && !isToolUIPart(part)) {
      segments.push(current)
      speakerId = nextSpeaker
      nextSpeaker = null
      current = {
        key: `${message.id}:${index}`,
        botId: speakerId,
        parts: [],
      }
    }
    current.parts.push({ part, index })
    const handoff = getHandoff(part)
    if (handoff) nextSpeaker = handoff.targetId
  })
  if ((includePending && segments.length === 0) || current.parts.some(({ part }) => part.type !== "step-start"))
    segments.push(current)
  return segments
}

export type PartBlock =
  | { kind: "activity"; key: number; parts: IndexedChatPart[] }
  | { kind: "content" | "approval"; key: number; part: ChatPart }

// Keep order: text, files, step boundaries and approval prompts end a Trace run.
export function groupChatParts(
  parts: IndexedChatPart[],
  isGroup = false
): PartBlock[] {
  const blocks: PartBlock[] = []
  let activity: Extract<PartBlock, { kind: "activity" }> | undefined
  for (const { part, index } of parts) {
    if (isGroup && part.type === "reasoning") continue
    if (!isGroup && isToolUIPart(part) && part.state === "approval-requested") {
      activity = undefined
      blocks.push({ kind: "approval", key: index, part })
    } else if (
      part.type === "reasoning" ||
      part.type === "source-url" ||
      part.type === "source-document" ||
      isToolUIPart(part)
    ) {
      if (!activity) {
        activity = { kind: "activity", key: index, parts: [] }
        blocks.push(activity)
      }
      activity.parts.push({ part, index })
    } else {
      activity = undefined
      if (part.type === "text" || part.type === "file") {
        blocks.push({ kind: "content", key: index, part })
      }
    }
  }
  return blocks
}

export function getToolPresentation(part: ChatToolPart, active: boolean) {
  const name = getToolName(part)
  const http = part.state === "output-available" ? record(part.output) : null
  if (http?.kind === "shared-http") {
    const label = String(http.displayName || name)
    const ok = http.success === true
    const summary = [
      http.botName,
      name,
      typeof http.status === "number" ? "HTTP " + http.status : null,
      typeof http.durationMs === "number" ? http.durationMs + " ms" : null,
    ]
    if (!ok && typeof http.message === "string") summary.push(http.message)
    return {
      name,
      label,
      status: ok ? undefined : ("error" as const),
      title: (ok ? "Ran " : "Failed · ") + label,
      input: undefined,
      output: undefined,
      error: null,
      reason: summary.filter(Boolean).join(" · "),
      deniedReason: null,
    }
  }
  const label =
    part.title ||
    name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ")
  if (name === projectDecisionTool) {
    const saved =
      part.state === "output-available" &&
      !part.preliminary &&
      http?.success === true &&
      typeof http.id === "string"
    const failed =
      http?.success === false ||
      part.state === "output-error" ||
      part.state === "output-denied"
    const evidence = saved && toolEvidenceSchema.safeParse(http.toolEvidence)
    return {
      name,
      label,
      memory:
        evidence &&
        evidence.success &&
        typeof http?.decision === "string" &&
        typeof http.sourceMessageId === "string"
          ? {
              decision: http.decision,
              sourceMessageId: http.sourceMessageId,
              evidence: evidence.data,
            }
          : undefined,
      status: saved
        ? undefined
        : failed
          ? ("error" as const)
          : active
            ? ("running" as const)
            : ("pending" as const),
      title: saved
        ? "Saved project decision · " + http.id
        : failed
          ? "Decision not saved"
          : active
            ? "Recording project decision"
            : "Pending project decision",
      reason: failed
        ? typeof http?.error === "string"
          ? http.error
          : "Could not save the decision."
        : null,
      input: undefined,
      output: undefined,
      error: null,
      deniedReason: null,
    }
  }
  const handoff = getHandoff(part)
  const failedHandoff =
    name === "handoff" &&
    part.state === "output-available" &&
    record(part.output)?.success === false
  let status: "running" | "error" | "pending" | undefined
  let title: string

  switch (part.state) {
    case "input-streaming":
      status = active ? "running" : "pending"
      title = active ? `Preparing ${label}` : `Incomplete ${label}`
      break
    case "input-available":
      status = active ? "running" : "pending"
      title = active
        ? name === "handoff"
          ? "Handing off"
          : `Running ${label}`
        : `Pending ${label}`
      break
    case "approval-requested":
      status = "pending"
      title = `Approve ${label}?`
      break
    case "approval-responded":
      status = part.approval.approved ? "pending" : undefined
      title = `${part.approval.approved ? "Approved" : "Denied"} ${label}`
      break
    case "output-denied":
      title = `Denied ${label}`
      break
    case "output-error":
      status = "error"
      title = `Failed to run ${label}`
      break
    case "output-available":
      status = failedHandoff
        ? "error"
        : part.preliminary && active
          ? "running"
          : undefined
      title = failedHandoff
        ? "Handoff failed"
        : handoff
          ? `Handed off to ${handoff.targetName}`
          : part.preliminary
            ? active
              ? `Receiving ${label} results`
              : `Partial results from ${label}`
            : `Ran ${label}`
      break
  }

  const error =
    part.state === "output-error"
      ? part.errorText
      : failedHandoff
        ? record(part.output)?.message
        : null
  return {
    name,
    label,
    status,
    title,
    input: name === "handoff" ? undefined : part.input,
    output:
      part.state === "output-available" && name !== "handoff"
        ? part.output
        : undefined,
    error: typeof error === "string" ? error : null,
    reason: handoff?.reason ?? null,
    deniedReason:
      part.state === "output-denied" || part.state === "approval-responded"
        ? part.approval.reason
        : undefined,
  }
}

export function getSkillReadPresentation(part: ChatToolPart, active: boolean) {
  if (getToolName(part) !== "read_skill") return null
  const output = part.state === "output-available" ? record(part.output) : null
  const name = output?.name ?? record(part.input)?.name
  const suffix = typeof name === "string" ? ` · ${name}` : ""
  if (
    part.state === "output-available" &&
    !part.preliminary &&
    output?.success === true
  )
    return {
      title: "已读取 Skill" + suffix,
      status: undefined,
      detail: "Instructions delivered to the bot.",
    }
  if (
    part.state === "output-error" ||
    part.state === "output-denied" ||
    output?.success === false
  )
    return {
      title: "Skill 读取失败" + suffix,
      status: "error" as const,
      detail:
        output?.success === false && typeof output.message === "string"
          ? output.message
          : "The skill could not be read.",
    }
  return {
    title: (active ? "正在读取 Skill" : "Skill 读取未完成") + suffix,
    status: active ? ("running" as const) : ("pending" as const),
    detail: null,
  }
}

export function safeChatUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol === "https:" || url.protocol === "http:") return url.href
  } catch {
    /* A source without a safe URL is still shown as plain text. */
  }
  return undefined
}

export function safeChatImageUrl(
  value: string,
  mediaType: string
): string | undefined {
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(mediaType)) return undefined
  return (
    safeChatUrl(value) ??
    (value.startsWith(`data:${mediaType};base64,`) ? value : undefined)
  )
}

export function formatToolValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2) ?? ""
  } catch {
    return "Unable to display this value."
  }
}
