import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"
import { toolDefinitions } from "./schema"
import {
  emptyToolInput,
  httpConfigSchema,
  maxSchemaBytes,
  parameterSchema,
  toolNameSchema,
  type ToolInputSchema,
} from "../lib/tool-definition"

export const toolDefinitionSchema = createInsertSchema(toolDefinitions, {
  name: toolNameSchema,
  displayName: z
    .string()
    .trim()
    .max(160)
    .nullish()
    .transform((value) => value || null),
  description: z
    .string()
    .trim()
    .min(1, "Describe when to use the tool.")
    .max(1024, "Use 1,024 characters or fewer."),
  kind: z.literal("http"),
  inputSchema: parameterSchema,
  config: httpConfigSchema,
})
  .pick({
    name: true,
    displayName: true,
    description: true,
    kind: true,
    inputSchema: true,
    config: true,
  })
  .strict()
  .superRefine(({ inputSchema, config }, ctx) => {
    if (config.method !== "GET") return
    const nested = Object.entries(inputSchema.properties).find(
      ([, p]) => p.type === "object" || p.type === "array"
    )
    if (nested)
      ctx.addIssue({
        code: "custom",
        path: ["inputSchema"],
        message:
          "GET parameter “" +
          nested[0] +
          "” must be a scalar. Use POST for nested parameters.",
      })
  })

export function formatToolInput(schema?: ToolInputSchema): string {
  if (!schema) return ""
  // An empty parameter map can still carry constraints or metadata.
  if (
    !Object.keys(schema.properties).length &&
    schema.required?.length === 0 &&
    schema.additionalProperties === false &&
    Object.keys(schema).every((key) => Object.hasOwn(emptyToolInput, key))
  )
    return ""
  return JSON.stringify(schema, null, 2)
}

// The editor holds JSON text; only the parsed and validated objects cross the
// action boundary. `displayName` stays optional in the round-trip contract
// because storage allows null; the form tightens it separately.
function createToolEditorSchema(displayName: z.ZodType<string>) {
  return z
    .object({
      displayName,
      name: z.string(),
      description: z.string(),
      method: z.enum(["GET", "POST"]),
      url: z.string(),
      authType: z.enum(["none", "bearer_env"]),
      envVar: z.string(),
      schemaText: z.string(),
    })
    .transform((fields, ctx) => {
      let inputSchema: unknown
      let jsonError: string | undefined
      if (new TextEncoder().encode(fields.schemaText).length > maxSchemaBytes)
        jsonError = "Keep the input schema within 32 KiB."
      else {
        try {
          inputSchema = fields.schemaText.trim()
            ? JSON.parse(fields.schemaText)
            : emptyToolInput
        } catch {
          jsonError = "Enter valid JSON for the input parameters."
        }
      }
      const result = toolDefinitionSchema.safeParse({
        name: fields.name,
        displayName: fields.displayName,
        description: fields.description,
        kind: "http",
        inputSchema,
        config: {
          method: fields.method,
          url: fields.url,
          auth:
            fields.authType === "none"
              ? { type: "none" }
              : { type: "bearer_env", envVar: fields.envVar },
        },
      })
      if (jsonError)
        ctx.addIssue({
          code: "custom",
          path: ["schemaText"],
          message: jsonError,
        })
      if (!result.success) {
        for (const issue of result.error.issues) {
          const [key, sub] = issue.path
          if (key === "inputSchema" && jsonError) continue
          const field =
            key === "inputSchema"
              ? "schemaText"
              : key === "config"
                ? sub === "auth"
                  ? "envVar"
                  : sub
                : key
          ctx.addIssue({
            code: "custom",
            path: [field ?? "schemaText"],
            message: issue.message,
          })
        }
        return z.NEVER
      }
      return result.data
    })
}

/**
 * The round-trip contract shared with `createTool` and `updateTool`. A blank
 * title is accepted and normalized to null, so an existing tool without one
 * survives a read/write cycle.
 */
export const toolEditorSchema = createToolEditorSchema(z.string())

/**
 * What the editor requires. The form shows a required Name and derives the
 * function name from it, so saving without a title fails validation before it
 * reaches a server action.
 */
export const toolFormSchema = createToolEditorSchema(
  z
    .string()
    .trim()
    .min(1, "Enter a name.")
    .max(160, "Use 160 characters or fewer.")
)

export type ToolEditorFields = z.input<typeof toolFormSchema>
export type ToolValues = z.output<typeof toolDefinitionSchema>
