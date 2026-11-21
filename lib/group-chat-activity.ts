import { getToolName, isToolUIPart, type UIMessage } from "ai"
import {
  getHandoff,
  type ChatToolPart,
  type IndexedChatPart,
} from "./chat-presentation"
import {
  projectDecisionTool,
  projectRecordId,
  toolCallAnchor,
  toolEvidenceSchema,
  type ToolEvidence,
} from "./project-decisions"

export type GroupActivity = {
  kind: "handoff" | "skill" | "tool" | "decision"
  title: string
  status?: "running" | "pending" | "error"
  result?: string
  decisionId?: string
  sourceAnchor?: string
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>
}

function outputOf(part: ChatToolPart) {
  return part.state === "output-available" ? object(part.output) : undefined
}

function describe(
  part: ChatToolPart,
  actor: string,
  active: boolean
): GroupActivity {
  const name = getToolName(part)
  const output = outputOf(part)
  const http = output?.kind === "shared-http"
  const label =
    http && typeof output.displayName === "string"
      ? output.displayName
      : part.title || name
  const kind =
    name === "handoff"
      ? "handoff"
      : name === "read_skill"
        ? "skill"
        : name === projectDecisionTool
          ? "decision"
          : "tool"
  const input = object(part.input)
  const handoff = getHandoff(part)
  const target = handoff?.targetName ?? input?.botName
  const skill = output?.name ?? input?.name
  const action = {
    handoff: typeof target === "string" ? "将任务交给 " + target : "交接任务",
    skill:
      "读取 Skill" + (typeof skill === "string" ? "「" + skill + "」" : ""),
    decision: "将结论保存到项目记忆",
    tool: "调用 Tool「" + label + "」",
  }[kind]
  const line = (
    text: string,
    status?: GroupActivity["status"]
  ): GroupActivity => ({ kind, title: actor + " " + text + "。", status })

  if (part.state === "approval-requested")
    return line("请求批准" + action, "pending")
  if (
    part.state === "output-denied" ||
    (part.state === "approval-responded" && !part.approval.approved)
  )
    return line(action + "未获批准", "error")
  if (part.state === "output-error" || output?.success === false)
    return line(action + "失败", "error")
  if (part.state === "approval-responded")
    return line(action + "已获批准，等待执行", "pending")
  if (part.state !== "output-available" || part.preliminary)
    return active
      ? line("正在" + action, "running")
      : line(action + "尚未完成", "pending")

  const decisionId =
    kind === "decision" ? projectRecordId.safeParse(output?.id).data : undefined
  if (
    ((kind !== "tool" || http) && output?.success !== true) ||
    (kind === "decision" && !decisionId) ||
    (kind === "handoff" && !handoff)
  )
    return line(action + "未获确认", "pending")
  if (kind === "tool") return line("的 Tool「" + label + "」调用已完成")
  return { ...line((kind === "handoff" ? "" : "已") + action), decisionId }
}

// Pair a unit only with an unambiguous measurement at the same object/array
// position. Otherwise show the fields separately, without inventing a unit.
function formatFields(fields: ToolEvidence["fields"]) {
  const items = fields.flatMap(({ path, value }) => {
    const parts = path
      .slice(1)
      .split("/")
      .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    if (
      parts.some((key) =>
        /^(?:debug|logs?|stack(?:trace)?|reasoning|thought)$/i.test(key)
      )
    )
      return []
    if (
      typeof value === "string" &&
      (/^\s*[[{]/.test(value) ||
        /^(?:body|raw|headers|input|output|payload|request|response)$/i.test(
          parts.at(-1)!
        ))
    )
      return []
    const index = /^\d+$/.test(parts.at(-1)!) ? parts.pop() : undefined
    const label = parts.pop() ?? index ?? path
    return [{ label, value, scope: JSON.stringify([parts, index]) }]
  })
  const descriptions: string[] = []
  for (const scope of new Set(items.map((item) => item.scope))) {
    const group = items.filter((item) => item.scope === scope)
    const unit = group.find((item) => /^units?$/i.test(item.label))
    const numbers = group.filter((item) => typeof item.value === "number")
    const measurement = numbers.length === 1 ? numbers[0] : undefined
    const metric = group.find(
      (item) => /^metric$/i.test(item.label) && typeof item.value === "string"
    )
    for (const item of group) {
      if (item === unit && measurement) continue
      if (item === metric && measurement) continue
      descriptions.push(
        (item === measurement && metric ? metric.value : item.label) +
          " " +
          item.value +
          (item === measurement && unit ? " " + unit.value : "")
      )
    }
  }
  return descriptions.length
    ? "结果：" + descriptions.join("，") + "。"
    : undefined
}

// The HTTP receipt confirms that the call ran. Only the saved evidence supplies
// public business fields. Match within this speaker's segment, never by label.
export function groupActivities(
  message: UIMessage,
  parts: IndexedChatPart[],
  actor: string,
  botId: string | null,
  active: boolean
) {
  const activities = new Map<string, GroupActivity>()
  const calls = new Map<string, ChatToolPart>()
  for (const { part } of parts) {
    if (!isToolUIPart(part)) continue
    calls.set(part.toolCallId, part)
    activities.set(part.toolCallId, describe(part, actor, active))
  }
  const executionId = object(message.metadata)?.executionId
  for (const [id, part] of calls) {
    const saved = activities.get(id)!
    if (!saved.decisionId) continue
    const output = outputOf(part)
    if (output?.sourceMessageId !== message.id) continue
    const evidence = toolEvidenceSchema.safeParse(output.toolEvidence).data
    if (!evidence || (executionId && evidence.executionId !== executionId))
      continue
    const source = calls.get(evidence.toolCallId)
    if (!source || source.state !== "output-available" || source.preliminary)
      continue
    const receipt = outputOf(source)
    const runtimeName = getToolName(source)
    if (
      receipt?.kind !== "shared-http" ||
      receipt.success !== true ||
      receipt.toolCallId !== source.toolCallId ||
      receipt.name !== evidence.toolName ||
      (runtimeName !== evidence.toolName &&
        runtimeName !== "shared-http-" + evidence.toolName) ||
      receipt.digest !== evidence.digest ||
      (botId && receipt.botId !== botId)
    )
      continue
    const result = activities.get(source.toolCallId)!
    const label =
      typeof receipt.displayName === "string"
        ? receipt.displayName
        : evidence.toolName
    result.result = formatFields(evidence.fields)
    if (result.result) result.title = actor + " 已调用 Tool「" + label + "」。"
    saved.sourceAnchor = toolCallAnchor(message.id, source.toolCallId)
  }
  return activities
}
