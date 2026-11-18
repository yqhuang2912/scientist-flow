import { test } from "node:test"
import assert from "node:assert/strict"
import {
  formatToolInput,
  toolDefinitionSchema,
  toolEditorSchema,
} from "../db/tool-form-schema"
import {
  emptyToolInput,
  toModelToolDefinition,
  type ToolInputSchema,
} from "../lib/tool-definition"

const query = {
  type: "string",
  description: "Words to find",
  minLength: 1,
} as const
const inputSchema = {
  ...emptyToolInput,
  properties: {
    query,
    limit: { type: "integer", minimum: 0 },
    reviewed: { type: "boolean", enum: [false, true] },
  },
  required: ["query"],
} satisfies ToolInputSchema
const config = {
  method: "GET",
  url: "https://example.com/search",
  auth: { type: "none" },
}
const definition = {
  name: "paper_search",
  description: " Find papers ",
  displayName: " ",
  kind: "http",
  config,
  inputSchema,
}
const editor = {
  name: definition.name,
  displayName: "",
  description: definition.description,
  method: "GET",
  authType: "none",
  envVar: "TOOL_PREVIOUS",
  url: config.url,
  schemaText: JSON.stringify(inputSchema),
}

test("editor and action round-trip typed objects, optional parameters, bounds, and enum values", () => {
  const saved = toolEditorSchema.parse(editor)
  assert.deepEqual(saved, {
    ...definition,
    description: "Find papers",
    displayName: null,
  })
  assert.deepEqual(
    toolDefinitionSchema.parse(JSON.parse(JSON.stringify(saved))),
    saved
  )
  assert.deepEqual(toModelToolDefinition({ ...saved }), {
    name: saved.name,
    description: saved.description,
    inputSchema,
  })
  assert.equal(
    toolEditorSchema.safeParse({ ...editor, schemaText: "broken" }).success,
    false
  )
})

test("blank input round-trips as the default no-parameter schema", () => {
  assert.equal(formatToolInput(), "")
  const reordered = {
    required: [],
    additionalProperties: false,
    properties: {},
    type: "object" as const,
  }
  assert.equal(formatToolInput(reordered), "")
  for (const schemaText of ["", "  \n"]) {
    assert.deepEqual(
      toolEditorSchema.parse({ ...editor, schemaText }).inputSchema,
      emptyToolInput
    )
  }
  for (const schema of [
    inputSchema,
    { ...emptyToolInput, maxProperties: 0 },
    { ...emptyToolInput, additionalProperties: true },
  ]) {
    const schemaText = formatToolInput(schema)
    assert.deepEqual(
      toolEditorSchema.parse({ ...editor, schemaText }).inputSchema,
      schema
    )
  }
})

test("only editable fields, dedicated bearer references and fixed HTTP configurations are accepted", () => {
  for (const name of [
    "",
    "Bad Name",
    "9papers",
    "read_skill",
    "handoff",
    "a".repeat(65),
  ])
    assert.equal(
      toolDefinitionSchema.safeParse({ ...definition, name }).success,
      false,
      name
    )
  for (const override of [
    { id: "provided" },
    { kind: "ssh" },
    { createdAt: new Date() },
    { description: " " },
    { inputSchema: JSON.stringify(inputSchema) },
  ])
    assert.equal(
      toolDefinitionSchema.safeParse({ ...definition, ...override }).success,
      false
    )
  for (const url of [
    "http://example.com",
    "/api",
    "https://user:token@example.com",
    "https://@example.com",
    "https://example.com/q?",
    "https://example.com/path#fragment",
    "https://example.com/{id}",
    "https://example.com/%7Bid%7D",
  ])
    assert.equal(
      toolDefinitionSchema.safeParse({
        ...definition,
        config: { ...config, url },
      }).success,
      false,
      url
    )
  for (const override of [
    { method: "DELETE" },
    { headers: {} },
    { auth: { type: "bearer_env", envVar: "DATABASE_URL" } },
    { auth: { type: "none", envVar: "TOOL_OLD" } },
    { auth: { type: "bearer_env", token: "literal" } },
  ])
    assert.equal(
      toolDefinitionSchema.safeParse({
        ...definition,
        config: { ...config, ...override },
      }).success,
      false
    )
})

test("enforces Draft-07 meta-schema, local vocabulary, application bounds and root structure", () => {
  let deep: object = query
  for (let i = 0; i < 9; i++) deep = { type: "array", items: deep }
  const post = { ...definition, config: { ...config, method: "POST" } }
  for (const schema of [
    null,
    { type: "array", items: query },
    { type: "object" },
    { ...inputSchema, required: ["missing"] },
    { ...inputSchema, required: ["query", "query"] },
    { ...inputSchema, $schema: "https://example.com/schema" },
    { ...inputSchema, $ref: "https://example.com/schema" },
    { ...inputSchema, properties: { query: { ...query, minLength: -1 } } },
    { ...inputSchema, properties: { query: { ...query, anyOf: [] } } },
    { ...inputSchema, properties: { query: { ...query, format: "uri" } } },
    { ...inputSchema, properties: { query: { type: "array", items: deep } } },
    { ...inputSchema, description: "文".repeat(12000) },
    { ...inputSchema, properties: { query: { ...query, enum: [] } } },
  ])
    assert.equal(
      toolDefinitionSchema.safeParse({ ...post, inputSchema: schema }).success,
      false
    )
  assert.equal(
    toolDefinitionSchema.safeParse({
      ...post,
      inputSchema: {
        ...inputSchema,
        $schema: "http://json-schema.org/draft-07/schema#",
      },
    }).success,
    true
  )
})

test("GET rejects nested query parameters, POST preserves the complete schema and model metadata omits execution fields", () => {
  const nested = {
    ...inputSchema,
    properties: {
      ...inputSchema.properties,
      filters: {
        type: "array",
        items: {
          type: "object",
          properties: { year: { type: "integer", minimum: 1900 } },
        },
      },
    },
  }
  const fields = {
    ...editor,
    schemaText: JSON.stringify(nested),
    authType: "bearer_env",
    envVar: "TOOL_PAPER_API_TOKEN",
  }
  assert.match(
    toolEditorSchema.safeParse(fields).error!.issues[0].message,
    /filters/
  )
  const saved = toolEditorSchema.parse({ ...fields, method: "POST" })
  assert.deepEqual(saved.inputSchema, nested)
  assert.deepEqual(saved.config.auth, {
    type: "bearer_env",
    envVar: fields.envVar,
  })
  const row = {
    ...saved,
    id: "row",
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  assert.deepEqual(Object.keys(toModelToolDefinition(row)).sort(), [
    "description",
    "inputSchema",
    "name",
  ])
})
