import { createHash } from "node:crypto"
import {
  jsonSchema,
  tool,
  type ToolSet,
  type ModelMessage,
  type StreamTextTransform,
} from "ai"
import { z } from "zod"
import type { ToolDefinition } from "../db/schema"
import { reservedToolNames, toModelToolDefinition } from "./tool-definition"
import { executeSharedHttpTool } from "./shared-http-executor"
import { publicHttpsRequest } from "./public-https"

type Bound = ToolDefinition & { botId: string; botName: string }
const past =
  "Historical HTTP call. Its recorded status is not a fresh observation."
const contextSchema = z.object({
  botId: z.string(),
  executionId: z.string().optional(),
})
// Existing definitions may predate a built-in. A hyphen cannot occur in a
// user-defined identifier, so this provider-facing alias is unambiguous.
const runtimeName = (name: string) =>
  reservedToolNames.has(name) ? "shared-http-" + name : name
function declaration(def: Bound) {
  const { name, description, inputSchema } = toModelToolDefinition(def)
  return {
    name: runtimeName(name),
    title: def.displayName || name,
    description,
    contextSchema,
    inputSchema: jsonSchema<Record<string, unknown>>(
      inputSchema as Parameters<typeof jsonSchema>[0]
    ),
  }
}
export function historyHttpTools(bindings: Bound[]): ToolSet {
  return Object.fromEntries(
    bindings.map((def) => [
      runtimeName(def.name),
      tool({
        ...declaration(def),
        toModelOutput: () => ({ type: "text", value: past }),
      }),
    ])
  )
}

export function httpToolTurn(
  bindings: Bound[],
  lookup: (botId: string, toolId: string) => Promise<Bound | undefined>,
  claim: (toolId: string, inputHash: string) => Promise<boolean>,
  send = publicHttpsRequest
) {
  const payloads = new Map<string, { botId: string; text: string }>()
  const uncertain = new Set<string>()
  const tools: ToolSet = Object.create(null)
  const names = (botId: string) =>
    bindings.filter((b) => b.botId === botId).map((b) => runtimeName(b.name))
  for (const def of bindings) {
    if (Object.hasOwn(tools, runtimeName(def.name))) continue
    tools[runtimeName(def.name)] = tool({
      ...declaration(def),
      execute: async (input, { context, toolCallId, abortSignal }) => {
        const start = Date.now()
        const binding = bindings.find(
          (b) => b.botId === context.botId && b.id === def.id
        )
        const receipt = {
          kind: "shared-http" as const,
          toolCallId,
          name: def.name,
          displayName: def.displayName || def.name,
          botId: context.botId,
          botName: binding?.botName ?? null,
        }
        const fail = (message: string) => ({
          ...receipt,
          success: false,
          status: null,
          durationMs: Date.now() - start,
          message,
        })
        if (!binding) return fail("This bot does not have this tool.")
        try {
          const live = await lookup(binding.botId, binding.id)
          if (
            !live ||
            live.name !== def.name ||
            live.updatedAt.getTime() !== def.updatedAt.getTime() ||
            JSON.stringify(live.config) !== JSON.stringify(def.config) ||
            JSON.stringify(live.inputSchema) !== JSON.stringify(def.inputSchema)
          )
            return fail(
              "The binding or tool definition changed. Start a new turn."
            )
          if (uncertain.has(def.id))
            return fail(
              "An earlier POST may have been processed. Verify the outcome before trying again."
            )
          const { name, displayName, description, kind, config, inputSchema } =
            live
          const result = await executeSharedHttpTool(
            { name, displayName, description, kind, config, inputSchema },
            input,
            abortSignal,
            async (request) => {
              if (request.method === "POST") {
                const canonical = JSON.stringify(input, (_k, v) =>
                  v && typeof v === "object" && !Array.isArray(v)
                    ? Object.fromEntries(
                        Object.entries(v).sort(([a], [b]) =>
                          a < b ? -1 : a > b ? 1 : 0
                        )
                      )
                    : v
                )
                const hash = createHash("sha256")
                  .update(canonical)
                  .digest("hex")
                if (!(await claim(def.id, hash)))
                  throw new Error("POST already claimed")
              }
              return send(
                context.executionId
                  ? {
                      ...request,
                      audit: { executionId: context.executionId, toolCallId },
                    }
                  : request
              )
            }
          )
          const base = {
            ...receipt,
            status: result.status,
            durationMs: Date.now() - start,
          }
          if (!result.success) {
            if (result.postOutcomeUnknown) uncertain.add(def.id)
            return { ...base, success: false, message: result.message }
          }
          payloads.set(toolCallId, {
            botId: context.botId,
            text: JSON.stringify(result.data),
          })
          return { ...base, success: true, digest: result.digest }
        } catch {
          return fail("Could not verify the current tool binding.")
        }
      },
      toModelOutput: ({ toolCallId, output }) => ({
        type: "text",
        value: output.success
          ? (payloads.get(toolCallId)?.text ?? past)
          : "message" in output
            ? output.message
            : past,
      }),
    })
  }
  function forSpeaker(messages: ModelMessage[], botId: string) {
    if (![...payloads.values()].some((p) => p.botId !== botId)) return messages
    return messages.map((m) =>
      m.role !== "tool"
        ? m
        : {
            ...m,
            content: m.content.map((p) =>
              p.type === "tool-result" &&
              payloads.has(p.toolCallId) &&
              payloads.get(p.toolCallId)?.botId !== botId
                ? { ...p, output: { type: "text" as const, value: past } }
                : p
            ),
          }
    )
  }
  return { tools, names, forSpeaker }
}

// Transform only the outward stream. The executor receives the original args;
// neither streamed partial args nor complete args belong in the replayable UI.
export function redactToolInputs<TOOLS extends ToolSet>(
  names: Set<string>
): StreamTextTransform<TOOLS> {
  return () => {
    const hidden = new Set<string>()
    return new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === "tool-input-start" && names.has(chunk.toolName))
          hidden.add(chunk.id)
        if (chunk.type === "tool-input-delta" && hidden.has(chunk.id)) return
        if (chunk.type === "tool-input-end") hidden.delete(chunk.id)
        if (
          (chunk.type === "tool-call" ||
            chunk.type === "tool-result" ||
            chunk.type === "tool-error") &&
          names.has(chunk.toolName)
        ) {
          controller.enqueue({
            ...chunk,
            input: {},
            ...(chunk.type === "tool-error" && { error: "Tool call failed." }),
            ...(chunk.type === "tool-call" &&
              chunk.invalid && { error: "Invalid tool arguments." }),
          })
        } else controller.enqueue(chunk)
      },
    })
  }
}
