import { z } from "zod"

import { mentionTargets } from "./chat-mentions"

const point = z.object({ x: z.number(), y: z.number() })
const baseNode = z.object({
  id: z.nanoid(),
  instructions: z.string(),
  position: point,
})
const botMention = z.object({
  kind: z.literal("bot"),
  value: z.nanoid(),
  label: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
})
const taskNode = baseNode
  .extend({
    title: z.string().trim().min(1).max(160),
    mentions: z.array(botMention),
  })
  .superRefine(({ instructions, mentions }, ctx) => {
    let end = 0
    for (const m of [...mentions].sort((a, b) => a.start - b.start)) {
      if (
        m.start < end ||
        m.end > instructions.length ||
        instructions.slice(m.start, m.end) !== "@" + m.label
      )
        ctx.addIssue({
          code: "custom",
          message: "Select the bot again to repair this mention.",
        })
      end = m.end
    }
  })
const legacyNode = baseNode.extend({ botId: z.nanoid() }).strict()
export type TaskNode = z.infer<typeof taskNode>
export type WorkflowNode = TaskNode | z.infer<typeof legacyNode>

export function nodeBotIds(node: WorkflowNode) {
  return "botId" in node
    ? [node.botId]
    : mentionTargets(node.mentions).mentionedBotIds
}

export function workflowBotIds(graph: WorkflowDraft) {
  return [...new Set(graph.nodes.flatMap(nodeBotIds))]
}

export function editableNode(
  node: WorkflowNode,
  bots: { id: string; name: string }[]
): TaskNode {
  if (!("botId" in node)) return node
  const label = bots.find((b) => b.id === node.botId)?.name ?? "Unavailable bot"
  const token = "@" + label
  return {
    id: node.id,
    position: node.position,
    title:
      node.instructions.trim().split("\n")[0].slice(0, 160) || "Untitled node",
    instructions: token + (node.instructions ? " " + node.instructions : ""),
    mentions: [
      { kind: "bot", value: node.botId, label, start: 0, end: token.length },
    ],
  }
}

export const workflowDraftSchema = z
  .object({
    nodes: z.array(z.union([taskNode, legacyNode])),
    edges: z.array(z.object({ source: z.nanoid(), target: z.nanoid() })),
    viewport: point.extend({ zoom: z.number().min(0.25).max(2) }),
  })
  .superRefine(({ nodes, edges }, ctx) => {
    const ids = new Set(nodes.map((node) => node.id))
    if (ids.size !== nodes.length)
      ctx.addIssue({
        code: "custom",
        message: "Each step needs a distinct ID.",
      })
    const connections = new Set<string>()
    for (const { source, target } of edges) {
      const key = source + ":" + target
      if (
        !ids.has(source) ||
        !ids.has(target) ||
        source === target ||
        connections.has(key)
      )
        ctx.addIssue({
          code: "custom",
          message: "Check the connections between steps.",
        })
      connections.add(key)
    }
  })

export type WorkflowDraft = z.infer<typeof workflowDraftSchema>
export const emptyWorkflowDraft: WorkflowDraft = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}
