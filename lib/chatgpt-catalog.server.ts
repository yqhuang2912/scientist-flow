import "server-only"
import { z } from "zod"
import { effortSchema, type CatalogModel } from "./model-catalog"
import { ChatGrantError } from "./chatgpt-oauth.server"

const entry = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  visibility: z.string(),
  supported_reasoning_levels: z
    .array(z.union([z.string(), z.object({ effort: z.string() })]))
    .nullish(),
  supported_reasoning_efforts: z.array(z.string()).nullish(),
})
export function decodeChatCatalog(body: unknown): CatalogModel[] {
  return z
    .object({
      models: z.array(z.object({ visibility: z.string() }).passthrough()),
    })
    .parse(body)
    .models.filter((m) => m.visibility === "list")
    .map((row) => {
      const m = entry.parse(row)
      const levels =
        m.supported_reasoning_levels?.map((e) =>
          typeof e === "string" ? e : e.effort
        ) ?? m.supported_reasoning_efforts
      const efforts = [
        ...new Set((levels ?? []).map((e) => effortSchema.parse(e))),
      ]
      return {
        id: m.slug,
        name: m.display_name,
        efforts,
        unavailable: null,
        fixedEffort: efforts.length === 1 ? efforts[0] : undefined,
        effortNote:
          levels == null
            ? "Levels unconfirmed"
            : !efforts.length
              ? "No selectable effort"
              : undefined,
      }
    })
}
export async function chatCatalog(
  access: string,
  transport: typeof fetch = fetch
) {
  const r = await transport("https://api.openai.com/v1/models", {
    headers: { Authorization: "Bearer " + access },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  })
  if (!r.ok)
    throw new ChatGrantError(
      r.status === 401
        ? "invalid"
        : r.status === 403
          ? "restricted"
          : r.status === 429
            ? "limited"
            : "catalog-error",
      "Could not load this ChatGPT account’s models (HTTP " + r.status + ")."
    )
  return decodeChatCatalog(await r.json())
}
