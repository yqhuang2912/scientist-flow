import "server-only"
import {
  gatewayBaseUrlSchema,
  openRouterBaseUrl,
  parseCatalog,
} from "./model-catalog"
import { ModelConnectionError } from "./model-credentials.server"

export class CatalogError extends ModelConnectionError {
  constructor(readonly state: "invalid" | "catalog-error") {
    super(
      state === "invalid"
        ? "The gateway rejected the API key."
        : "Could not load the gateway’s models. Check the base URL and try again."
    )
  }
}
export async function accountCatalog(
  baseUrl: string,
  key: string | null,
  transport: typeof fetch = fetch
) {
  const base = gatewayBaseUrlSchema.parse(baseUrl)
  const openRouter = base === openRouterBaseUrl
  if (openRouter && !key)
    throw new ModelConnectionError("Enter an OpenRouter API key.")
  async function read(path: string) {
    const response = await transport(base + "/" + path, {
      headers: key ? { Authorization: "Bearer " + key } : {},
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 401 || (path === "key" && response.status === 403))
      throw new CatalogError("invalid")
    if (!response.ok) throw new CatalogError("catalog-error")
    return response.json()
  }
  try {
    if (openRouter && !(await read("key"))?.data)
      throw new CatalogError("invalid")
    return parseCatalog(
      await read(openRouter ? "models/user" : "models"),
      openRouter
    )
  } catch (error) {
    throw error instanceof CatalogError
      ? error
      : new CatalogError("catalog-error")
  }
}
