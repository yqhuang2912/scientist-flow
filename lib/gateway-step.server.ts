import "server-only"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { wrapLanguageModel, type ModelMessage, type ToolResultPart } from "ai"
import { ModelConnectionError } from "./model-credentials.server"
import {
  gatewayBaseUrlSchema,
  openRouterBaseUrl,
  type Effort,
} from "./model-catalog"

export interface OutboundRecord {
  model: string
  effort: string | null
  httpStatus: number | null
}
type Route = {
  modelId: string
  effort: Effort | null
  baseUrl: string
  apiKey: string | null
  authorize: () => Promise<void>
  record: (fields: OutboundRecord) => Promise<string>
  response: (
    attempt: string,
    fields: { responseId: string | null; responseModel: string | null }
  ) => Promise<void>
}
// Each instance belongs to a single turn/step. Observe the serialized request
// at the transport boundary; never retain headers, messages or raw responses.
export function gatewayStep(route: Route, transport: typeof fetch = fetch) {
  let attempt: string | undefined
  const baseURL = gatewayBaseUrlSchema.parse(route.baseUrl)
  const openRouter = baseURL === openRouterBaseUrl
  if (openRouter && !route.apiKey)
    throw new ModelConnectionError("Enter an OpenRouter API key.")
  const send: typeof fetch = async (url, init) => {
    if (
      String(url) !== baseURL + "/chat/completions" ||
      init?.method?.toUpperCase() !== "POST" ||
      typeof init.body !== "string" ||
      new Headers(init.headers).get("authorization") !==
        (route.apiKey ? "Bearer " + route.apiKey : null)
    )
      throw new ModelConnectionError(
        "The gateway request did not match the selected connection."
      )
    const body = JSON.parse(init.body)
    const effort = body.reasoning?.effort ?? body.reasoning_effort ?? null
    if (
      body.model !== route.modelId ||
      effort !== route.effort ||
      body.models ||
      body.route ||
      (openRouter ? body.reasoning_effort != null : body.reasoning != null) ||
      (body.reasoning != null &&
        (!route.effort ||
          Object.keys(body.reasoning).some((key) => key !== "effort")))
    )
      throw new ModelConnectionError(
        "The request did not match the bot’s model settings."
      )
    await route.authorize()
    const fields = {
      model: body.model as string,
      effort: effort as string | null,
    }
    let res: Response
    try {
      res = await transport(url, { ...init, redirect: "error" })
    } catch (error) {
      if (init.signal?.aborted) throw error
      await route.record({ ...fields, httpStatus: null })
      throw new ModelConnectionError("The gateway could not be reached.")
    }
    attempt = await route.record({ ...fields, httpStatus: res.status })
    if (!res.ok) {
      await res.body?.cancel()
      throw new ModelConnectionError(
        res.status === 401 || res.status === 403
          ? "The gateway denied access. Check this bot’s model connection."
          : "Gateway request failed (HTTP " +
              res.status +
              "). Check model availability, credits or rate limits."
      )
    }
    return res
  }
  const config = { baseURL, apiKey: route.apiKey ?? undefined, fetch: send }
  const gateway = openRouter
    ? createOpenRouter(config).chat(route.modelId)
    : createOpenAICompatible({ ...config, name: "customGateway" }).chatModel(
        route.modelId
      )
  const model = wrapLanguageModel({
    model: gateway,
    middleware: {
      specificationVersion: "v4",
      wrapStream: async ({ doStream }) => {
        const result = await doStream()
        let responseId: string | null = null,
          responseModel: string | null = null
        const id = attempt
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              async transform(chunk, controller) {
                controller.enqueue(chunk)
                if (chunk.type === "response-metadata") {
                  const nextId = chunk.id ?? responseId
                  const nextModel = chunk.modelId ?? responseModel
                  if (
                    id &&
                    (responseId !== nextId || responseModel !== nextModel)
                  ) {
                    responseId = nextId
                    responseModel = nextModel
                    await route.response(id, { responseId, responseModel })
                  }
                }
              },
            })
          ),
        }
      },
    },
  })
  const providerOptions: NonNullable<ModelMessage["providerOptions"]> = {}
  if (route.effort) {
    if (openRouter)
      providerOptions.openrouter = { reasoning: { effort: route.effort } }
    else providerOptions.customGateway = { reasoningEffort: route.effort }
  }
  return { model, providerOptions }
}

// Provider-specific reasoning/signatures belong to the model that produced
// them. A direct chat can retain its own historical tool calls and results.
export function portableHistory(messages: ModelMessage[]): ModelMessage[] {
  function withoutOptions<T extends object>(part: T): T {
    const copy = { ...part }
    if ("providerOptions" in copy) delete copy.providerOptions
    return copy
  }
  function portableResult(part: ToolResultPart): ToolResultPart {
    const output = withoutOptions(part.output)
    if (output.type === "content")
      output.value = output.value.map(withoutOptions)
    return { ...withoutOptions(part), output }
  }
  return messages.flatMap((message): ModelMessage[] => {
    const clean = { ...message }
    delete clean.providerOptions
    if (typeof clean.content === "string") return [clean]
    if (clean.role === "assistant") {
      clean.content = clean.content
        .filter((p) => p.type !== "reasoning" && p.type !== "reasoning-file")
        .map((p) =>
          p.type === "tool-result" ? portableResult(p) : withoutOptions(p)
        )
      return clean.content.length ? [clean] : []
    }
    if (clean.role === "tool")
      clean.content = clean.content.map((p) =>
        p.type === "tool-result" ? portableResult(p) : withoutOptions(p)
      )
    if (clean.role === "user" && Array.isArray(clean.content))
      clean.content = clean.content.map(withoutOptions)
    return [clean]
  })
}
