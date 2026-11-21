import { z } from "zod"

const point = z.object({ x: z.number(), y: z.number() })
export const workflowDraftSchema = z
  .object({
    nodes: z.array(
      z.object({
        id: z.nanoid(),
        botId: z.nanoid(),
        instructions: z.string(),
        position: point,
      })
    ),
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
