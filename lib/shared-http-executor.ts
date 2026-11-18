import Ajv from "ajv"
import { createHash } from "node:crypto"
import { toolDefinitionSchema } from "../db/tool-form-schema"
import {
  PublicTargetError,
  publicHttpsRequest,
  type ToolRequest,
  type ToolResponse,
} from "./public-https"

const limit = 64 * 1024
const validator = new Ajv({
  ownProperties: true,
  strict: false,
  addUsedSchema: false,
})
type HttpResult =
  | { success: true; status: number; data: unknown; digest: string }
  | {
      success: false
      status: number | null
      message: string
      postOutcomeUnknown?: boolean
    }

export async function executeSharedHttpTool(
  definition: unknown,
  input: unknown,
  abortSignal?: AbortSignal,
  transport: (
    request: ToolRequest
  ) => Promise<ToolResponse> = publicHttpsRequest
): Promise<HttpResult> {
  const parsed = toolDefinitionSchema.safeParse(definition)
  if (!parsed.success)
    return {
      success: false,
      status: null,
      message: "Invalid HTTP tool definition.",
    }
  const { config, inputSchema } = parsed.data
  let status: number | null = null
  let dispatched = false
  const fail = (message: string): HttpResult => {
    const postOutcomeUnknown = dispatched && config.method === "POST"
    return {
      success: false,
      status,
      postOutcomeUnknown,
      message: postOutcomeUnknown
        ? message +
          " The POST may have been processed. Do not retry automatically."
        : message,
    }
  }
  const signal = AbortSignal.any([
    AbortSignal.timeout(12000),
    ...(abortSignal ? [abortSignal] : []),
  ])
  try {
    const body = JSON.stringify(input)
    if (Buffer.byteLength(body) > limit)
      return fail("Tool arguments exceed 64 KiB.")
    const check = validator.compile(inputSchema)
    validator.removeSchema(inputSchema)
    if (!check(input))
      return fail("Arguments do not match the tool’s input schema.")
    const url = new URL(config.url)
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "ScientistFlow/1.0",
      "accept-encoding": "identity",
    }
    if (config.method === "GET") {
      for (const [key, value] of Object.entries(
        input as Record<string, unknown>
      )) {
        if (!["string", "number", "boolean"].includes(typeof value))
          return fail("GET requires scalar query parameters.")
        url.searchParams.append(key, String(value))
      }
    } else headers["content-type"] = "application/json"
    let token: string | undefined
    if (config.auth.type === "bearer_env") {
      const origins = JSON.parse(
        process.env.SCIENTISTFLOW_TOOL_BEARER_ORIGINS ?? "{}"
      ) as Record<string, unknown>
      if (origins?.[config.auth.envVar] !== url.origin)
        return fail("Credential is not authorized for this origin.")
      token = process.env[config.auth.envVar]
      if (!token || /[\r\n]/.test(token))
        return fail("The configured credential is unavailable.")
      headers.authorization = "Bearer " + token
    }
    signal.throwIfAborted()
    dispatched = true
    const res = await transport({
      url,
      method: config.method,
      headers,
      body: config.method === "POST" ? body : undefined,
      signal,
    })
    status = res.status
    try {
      if (status < 200 || status >= 300)
        return fail("Endpoint returned HTTP " + status + ".")
      if (
        !/^(?:application\/json|application\/[\w.+-]+\+json)(?:\s*;|$)/i.test(
          res.contentType
        )
      )
        return fail("Expected a JSON response.")
      const chunks: Buffer[] = []
      let size = 0
      for await (const part of res.body) {
        const bytes = Buffer.from(part)
        size += bytes.length
        if (size > limit) return fail("Response exceeds 64 KiB.")
        chunks.push(bytes)
      }
      const bytes = Buffer.concat(chunks)
      const data: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        (key, value) =>
          /^(?:authorization|proxy-authorization|cookie|set-cookie|(?:access|refresh|id)[_-]?token|token|api[_-]?key|client[_-]?secret|password|private[_-]?key)$/i.test(
            key
          )
            ? "[redacted]"
            : value
      )
      if (token && JSON.stringify(data).includes(token))
        return fail(
          "Response contained the configured credential and was withheld."
        )
      return {
        success: true,
        status,
        data,
        digest: createHash("sha256").update(bytes).digest("hex"),
      }
    } finally {
      res.body.destroy()
    }
  } catch (error) {
    if (error instanceof PublicTargetError) return fail(error.message)
    const message = signal.aborted
      ? "Request canceled or timed out."
      : "Could not complete a public HTTPS JSON request."
    return fail(message)
  }
}
