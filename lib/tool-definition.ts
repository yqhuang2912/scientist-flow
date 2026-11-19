import Ajv from "ajv"
import { z } from "zod"
import { projectDecisionTool } from "./project-decisions"

// Local definitions use Draft-07. A future runner must also check its own
// built-in names when assembling tools, and retain definitions on Bot deletion.
export const reservedToolNames: ReadonlySet<string> = new Set([
  "read_skill",
  "handoff",
  projectDecisionTool,
])
export const toolIdentifierSchema = z
  .string()
  .min(1, "Enter a tool identifier.")
  .max(64, "Use 64 characters or fewer.")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Start with a lowercase letter and use lowercase letters, numbers or underscores."
  )
export const toolNameSchema = toolIdentifierSchema.refine(
  (name) => !reservedToolNames.has(name),
  "This identifier is reserved by the chat runtime."
)

// Transport contract for a future executor: GET encodes supplied scalar values
// (including 0 and false); POST sends the validated object as a JSON body.
export const httpConfigSchema = z.strictObject({
  method: z.enum(["GET", "POST"]),
  url: z
    .string()
    .max(2048)
    .refine((value) => {
      if (
        !/^https:\/\/[^/]/i.test(value) ||
        /[\s\\?#{}<>]|%7[bd]|%3[ce]/i.test(value)
      )
        return false
      if (value.split("/")[2]?.includes("@")) return false
      try {
        const url = new URL(value)
        return (
          url.protocol === "https:" &&
          !!url.hostname &&
          !/\/:\w/.test(url.pathname) &&
          !url.username &&
          !url.password
        )
      } catch {
        return false
      }
    }, "Enter a fixed HTTPS address without credentials, placeholders, a query or a fragment."),
  auth: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("none") }),
    z.strictObject({
      type: z.literal("bearer_env"),
      envVar: z
        .string()
        .max(128)
        .regex(
          /^TOOL_[A-Z][A-Z0-9_]*$/,
          "Use a dedicated variable name such as TOOL_PAPER_API_TOKEN."
        ),
    }),
  ]),
})
export type HttpToolConfig = z.infer<typeof httpConfigSchema>

const numeric = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]
const keywords = {
  object: [
    "properties",
    "required",
    "additionalProperties",
    "minProperties",
    "maxProperties",
  ],
  array: ["items", "minItems", "maxItems", "uniqueItems"],
  string: ["minLength", "maxLength"],
  number: numeric,
  integer: numeric,
  boolean: [],
}
type ParameterType = keyof typeof keywords
export type ParameterSchema = {
  type: ParameterType
  description?: string
  properties?: Record<string, ParameterSchema>
  required?: string[]
  items?: ParameterSchema
  enum?: (string | boolean | number)[]
  additionalProperties?: boolean
  [keyword: string]: unknown
}
export type ToolInputSchema = ParameterSchema & {
  type: "object"
  properties: Record<string, ParameterSchema>
}
export const emptyToolInput: ToolInputSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
}
export const maxSchemaBytes = 32 * 1024
const draft = "http://json-schema.org/draft-07/schema#"
const ajv = new Ajv({ ownProperties: true })
const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))

// Restrict the vocabulary before handing it to the local Draft-07 meta-schema.
// No registries, external references or user-supplied executable validators.
function checkNode(
  node: unknown,
  path: string,
  depth: number
): string | undefined {
  if (depth > 8) return path + ": use at most 8 schema levels."
  if (
    !plainObject(node) ||
    typeof node.type !== "string" ||
    !Object.hasOwn(keywords, node.type)
  )
    return path + ": specify a supported parameter type."
  if (depth === 1 && node.type !== "object")
    return "The root schema must have type object."
  const allowed = new Set([
    "type",
    "title",
    "description",
    "enum",
    ...keywords[node.type as ParameterType],
  ])
  if (depth === 1) allowed.add("$schema")
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) return path + ": unsupported keyword " + key + "."
  }
  if ("$schema" in node && node.$schema !== draft)
    return "Only JSON Schema Draft-07 is supported."
  if (
    node.enum !== undefined &&
    (!Array.isArray(node.enum) ||
      !node.enum.length ||
      !node.enum.every((v) =>
        node.type === "integer"
          ? Number.isInteger(v)
          : ["string", "boolean", "number"].includes(typeof v) &&
            typeof v === node.type
      ))
  )
    return path + ".enum: use scalar values matching the parameter type."
  if (node.type === "array")
    return checkNode(node.items, path + ".items", depth + 1)
  if (node.type !== "object") return
  if (!plainObject(node.properties))
    return path + ".properties: enter a parameter map."
  if (
    "additionalProperties" in node &&
    typeof node.additionalProperties !== "boolean"
  )
    return path + ".additionalProperties: use true or false."
  for (const key of Object.keys(node.properties)) {
    if (key === "__proto__")
      return path + ".properties: this parameter name is unsupported."
    const error = checkNode(
      node.properties[key],
      path + ".properties." + key,
      depth + 1
    )
    if (error) return error
  }
  if (Array.isArray(node.required)) {
    for (const key of node.required) {
      if (typeof key !== "string" || !Object.hasOwn(node.properties, key))
        return path + ".required: each name must exist in properties."
    }
  }
}

export const parameterSchema = z
  .unknown()
  .transform((value, ctx): ToolInputSchema => {
    let error: string | undefined
    try {
      const json = JSON.stringify(value, (_key, item) => {
        if (
          item === undefined ||
          (typeof item === "number" && !Number.isFinite(item))
        )
          throw new Error()
        return item
      })
      if (new TextEncoder().encode(json).length > maxSchemaBytes)
        error = "Keep the input schema within 32 KiB."
      else error = checkNode(value, "schema", 1)
      if (!error && !ajv.validateSchema(value as ToolInputSchema)) {
        const issue = ajv.errors?.[0]
        error =
          "schema" +
          (issue?.instancePath ?? "") +
          " " +
          (issue?.message ?? "is invalid") +
          "."
      }
    } catch {
      error = "Enter a valid, bounded JSON schema."
    }
    if (error) {
      ctx.addIssue({ code: "custom", message: error })
      return z.NEVER
    }
    return value as ToolInputSchema
  })

export function toModelToolDefinition({
  name,
  description,
  inputSchema,
}: {
  name: string
  description: string
  inputSchema: ToolInputSchema
}) {
  return { name, description, inputSchema }
}

export type ToolResult<T> =
  { success: true; data: T } | { success: false; error: string }
