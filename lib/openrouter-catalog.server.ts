import "server-only"
import { parseCatalog } from "./model-catalog"
import { ModelConnectionError } from "./model-credentials.server"

export class CatalogError extends ModelConnectionError {
  constructor(readonly state: "invalid" | "catalog-error") {
    super(
      state === "invalid"
        ? "OpenRouter rejected this API key."
        : "Could not load the OpenRouter account catalog. Try again."
    )
  }
}
export async function accountCatalog(
  key: string,
  transport: typeof fetch = fetch
) {
  async function read(path: string) {
    const response = await transport("https://openrouter.ai/api/v1/" + path, {
      headers: { Authorization: "Bearer " + key },
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
    if (!(await read("key"))?.data) throw new CatalogError("invalid")
    return parseCatalog(await read("models/user"))
  } catch (error) {
    throw error instanceof CatalogError
      ? error
      : new CatalogError("catalog-error")
  }
}
