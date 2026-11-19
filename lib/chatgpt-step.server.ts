import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { createOpenAI } from "@ai-sdk/openai"
import { wrapLanguageModel } from "ai"
import { ModelConnectionError } from "./model-credentials.server"
import { ChatGrantError } from "./chatgpt-oauth.server"
import type { OutboundRecord } from "./gateway-step.server"

type Outcome =
  "completed" | "failed" | "incomplete" | "interrupted" | "cancelled"
type Receipt = { outcome: Outcome; responseId?: string; responseModel?: string }
type Route = {
  modelId: string
  effort: string | null
  token: () => Promise<string>
  authorize: () => Promise<void>
  record: (fields: OutboundRecord) => Promise<string>
  receipt: (id: string, fields: Receipt) => Promise<void>
  block: (error: ChatGrantError) => Promise<void>
}
function admission(status: number, code: unknown) {
  if (code === "subscription_sharing_usage_limit_exceeded" || status === 429)
    return new ChatGrantError(
      "limited",
      "This ChatGPT account reached its plan limit. Check ChatGPT Settings → Usage, then refresh the connection."
    )
  if (code === "subscription_sharing_usage_unavailable")
    return new ModelConnectionError(
      "ChatGPT could not check plan usage. Try again later."
    )
  if (code === "subscription_sharing_route_not_supported")
    return new ModelConnectionError(
      "This request is unavailable through ChatGPT plan usage."
    )
  if (status === 404)
    return new ModelConnectionError(
      "This model is unavailable. Refresh the selected account’s models and check this bot’s selection."
    )
  if (status === 401)
    return new ChatGrantError(
      "invalid",
      "This ChatGPT authorization is no longer valid. Reauthorize this connection."
    )
  if (status === 403)
    return new ChatGrantError(
      "restricted",
      "This ChatGPT account or workspace does not permit the request. Check its plan permissions."
    )
  return new ModelConnectionError(
    status === 200
      ? "The selected ChatGPT account could not complete the response."
      : "ChatGPT request failed (HTTP " + status + ")."
  )
}
export function chatGPTStep(route: Route, transport: typeof fetch = fetch) {
  const invocation = new AsyncLocalStorage<{ id?: string }>()
  const provider = createOpenAI({
    // The actual credential is obtained at the network boundary for this connection.
    apiKey: "local-profile",
    baseURL: "https://api.openai.com/v1",
    fetch: async (url, init) => {
      if (
        String(url) !== "https://api.openai.com/v1/responses" ||
        init?.method !== "POST" ||
        typeof init.body !== "string"
      )
        throw new ModelConnectionError("Unexpected ChatGPT endpoint.")
      const body = JSON.parse(init.body)
      if (
        body.model !== route.modelId ||
        body.store !== false ||
        body.stream !== true ||
        !Array.isArray(body.input) ||
        (body.reasoning?.effort ?? null) !== route.effort ||
        body.previous_response_id ||
        body.conversation
      )
        throw new ModelConnectionError(
          "The request did not match this ChatGPT connection."
        )
      for (const item of body.input) {
        if (item.role === "system")
          throw new ModelConnectionError("Expected developer instructions.")
        if (item.type === "function_call" && !item.namespace)
          item.namespace = "scientistflow"
      }
      if (body.tools?.some((t: { type: string }) => t.type !== "namespace"))
        throw new ModelConnectionError(
          "ChatGPT subscription requires namespaced tools."
        )
      const current = invocation.getStore()
      if (!current)
        throw new ModelConnectionError(
          "ChatGPT plan requests require streaming."
        )
      let token: string
      try {
        token = await route.token()
      } catch (e) {
        if (e instanceof ChatGrantError) await route.block(e)
        throw e
      }
      // Refresh may have waited for another process. Recheck the binding just before sending.
      await route.authorize()
      const headers = new Headers(init.headers)
      headers.set("Authorization", "Bearer " + token)
      const fields = { model: body.model as string, effort: route.effort }
      let response: Response
      try {
        response = await transport(url, {
          ...init,
          body: JSON.stringify(body),
          headers,
          redirect: "error",
        })
      } catch {
        const requestId = await route.record({ ...fields, httpStatus: null })
        await route.receipt(requestId, {
          outcome: init.signal?.aborted ? "cancelled" : "interrupted",
        })
        throw new ModelConnectionError(
          "The ChatGPT connection was interrupted."
        )
      }
      const requestId = await route.record({
        ...fields,
        httpStatus: response.status,
      })
      current.id = requestId
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        const error = admission(response.status, data?.error?.code)
        await route.receipt(requestId, { outcome: "failed" })
        if (error instanceof ChatGrantError) await route.block(error)
        throw error
      }
      return response
    },
  })
  const model = wrapLanguageModel({
    model: provider.responses(route.modelId),
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        includeRawChunks: true,
        tools: params.tools?.map((t) =>
          t.type === "function"
            ? {
                ...t,
                providerOptions: {
                  ...t.providerOptions,
                  openai: {
                    ...t.providerOptions?.openai,
                    namespace: {
                      name: "scientistflow",
                      description:
                        "Tools assigned to the current ScientistFlow bot.",
                    },
                  },
                },
              }
            : t
        ),
      }),
      wrapStream: async ({ doStream }) => {
        const current: { id?: string } = {}
        const result = await invocation.run(current, doStream)
        if (!current.id)
          throw new ModelConnectionError("Missing ChatGPT request receipt.")
        const id = current.id,
          reader = result.stream.getReader()
        let complete = false,
          settled = false,
          responseId: string | undefined,
          responseModel: string | undefined
        async function settle(outcome: Outcome) {
          if (!settled) {
            settled = true
            await route.receipt(id, { outcome, responseId, responseModel })
          }
        }
        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              try {
                for (;;) {
                  const { done, value } = await reader.read()
                  if (done) {
                    if (!complete)
                      throw new ModelConnectionError(
                        "The ChatGPT stream ended before confirmation."
                      )
                    await settle("completed")
                    controller.close()
                    return
                  }
                  if (value.type === "raw") {
                    const event = value.rawValue as {
                      type?: string
                      response?: {
                        id?: string
                        model?: string
                        error?: { code?: string }
                      }
                      code?: string
                    }
                    if (event.response?.id) responseId = event.response.id
                    if (event.response?.model)
                      responseModel = event.response.model
                    if (event.type === "response.completed") complete = true
                    if (
                      event.type === "response.failed" ||
                      event.type === "error" ||
                      event.type === "response.incomplete"
                    ) {
                      await settle(
                        event.type === "response.incomplete"
                          ? "incomplete"
                          : "failed"
                      )
                      const error = admission(
                        200,
                        event.response?.error?.code ?? event.code
                      )
                      if (error instanceof ChatGrantError)
                        await route.block(error)
                      throw error
                    }
                    continue
                  }
                  if (value.type === "error")
                    throw new ModelConnectionError(
                      "Invalid or failed ChatGPT response stream."
                    )
                  if (value.type === "finish") {
                    if (!complete)
                      throw new ModelConnectionError(
                        "The ChatGPT stream ended before confirmation."
                      )
                    await settle("completed")
                  }
                  controller.enqueue(value)
                  return
                }
              } catch (e) {
                await settle("interrupted")
                await reader.cancel().catch(() => {})
                controller.enqueue({
                  type: "error",
                  error:
                    e instanceof ModelConnectionError
                      ? e
                      : new ModelConnectionError(
                          "The ChatGPT stream was interrupted."
                        ),
                })
                controller.close()
              }
            },
            async cancel(reason) {
              await reader.cancel(reason)
              await settle("cancelled")
            },
          }),
        }
      },
    },
  })
  return {
    model,
    providerOptions: {
      openai: {
        store: false,
        systemMessageMode: "developer",
        forceReasoning: !!route.effort,
        ...(route.effort && { reasoningEffort: route.effort }),
      },
    },
  }
}
