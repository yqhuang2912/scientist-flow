import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { once } from "node:events"
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"
import { z } from "zod"
import { ModelConnectionError } from "./model-credentials.server"
import {
  hostIdentifier,
  withRegistration,
  type Registration,
} from "./chatgpt-vault.server"

const issuer = "https://auth.openai.com"
const resource = "https://api.openai.com/v1"
export const planScope = "chatgpt.tokens.use.direct"
const scopes =
  "openid profile email offline_access resource.invoke " + planScope
const keys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks.json"))
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  token_type: z.string().regex(/^bearer$/i),
  scope: z.string().optional(),
})
const random = () => randomBytes(32).toString("base64url")
export class ChatGrantError extends ModelConnectionError {
  constructor(
    readonly state:
      "identity-only" | "invalid" | "restricted" | "limited" | "catalog-error",
    message: string
  ) {
    super(message)
  }
}
async function exchange(grant: Record<string, string>) {
  const response = await fetch(issuer + "/api/accounts/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...grant, resource }),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const code =
      typeof data?.error === "string" ? data.error : data?.error?.code
    if (
      [
        "invalid_grant",
        "invalid_refresh_token",
        "token_expired",
        "refresh_token_expired",
        "refresh_token_invalidated",
        "refresh_token_reused",
      ].includes(code)
    )
      throw new ChatGrantError(
        "invalid",
        "This ChatGPT authorization expired. Reauthorize the selected account."
      )
    throw new ModelConnectionError(
      "ChatGPT token exchange failed (HTTP " + response.status + ")."
    )
  }
  return tokenSchema.parse(data)
}

export async function accessForProfile(ref: string): Promise<string> {
  const result = await withRegistration(ref, async (value, save) => {
    const tokens = value.tokens
    if (!tokens)
      throw new ChatGrantError(
        "invalid",
        "Reauthorize the selected ChatGPT account."
      )
    if (!tokens.scopes.includes(planScope))
      throw new ChatGrantError(
        "identity-only",
        "Reauthorize this ChatGPT account for plan usage."
      )
    if (tokens.expiresAt > Date.now() + 60_000) return tokens.access
    if (!tokens.refresh)
      throw new ChatGrantError(
        "invalid",
        "Sign in again to renew this ChatGPT account."
      )
    try {
      const next = await exchange({
        grant_type: "refresh_token",
        client_id: value.clientId,
        refresh_token: tokens.refresh,
      })
      const granted =
        next.scope === undefined ? tokens.scopes : next.scope.split(/\s+/)
      save({
        ...value,
        tokens: {
          access: next.access_token,
          refresh: next.refresh_token ?? tokens.refresh,
          id: tokens.id,
          expiresAt: Date.now() + next.expires_in * 1000,
          scopes: granted,
        },
      })
      return granted.includes(planScope) ? next.access_token : false
    } catch (error) {
      if (!(error instanceof ChatGrantError)) throw error
      save({ ...value, tokens: null })
      return null
    }
  })
  if (result === false)
    throw new ChatGrantError(
      "identity-only",
      "Enable plan usage for this ChatGPT account."
    )
  if (!result)
    throw new ChatGrantError(
      "invalid",
      "Reauthorize the selected ChatGPT account."
    )
  return result
}
export async function revokeProfile(ref: string) {
  return withRegistration(ref, async (value, save) => {
    let confirmed = true
    if (value.tokens?.refresh) {
      confirmed = false
      for (let i = 0; i < 2; i++) {
        const response = await fetch(issuer + "/api/accounts/oauth/revoke", {
          method: "POST",
          body: new URLSearchParams({
            token: value.tokens.refresh,
            token_type_hint: "refresh_token",
            client_id: value.clientId,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        }).catch(() => null)
        if (response?.status === 200) {
          confirmed = true
          break
        }
        if (response && response.status < 500) break
        if (i === 0) await new Promise((resolve) => setTimeout(resolve, 350))
      }
    }
    save({ ...value, tokens: null })
    return confirmed
  })
}

export async function verifiedIdentity(
  token: string,
  clientId: string,
  nonce: string,
  subject?: string,
  signingKeys: JWTVerifyGetKey = keys
) {
  const { payload } = await jwtVerify(token, signingKeys, {
    issuer,
    audience: clientId,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "nonce"],
  })
  if (
    payload.nonce !== nonce ||
    !payload.sub ||
    ((payload.azp !== undefined ||
      (Array.isArray(payload.aud) && payload.aud.length > 1)) &&
      payload.azp !== clientId) ||
    (subject !== undefined && payload.sub !== subject)
  )
    throw new ModelConnectionError(
      "The signed-in identity did not match this connection."
    )
  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
  }
}

type Status = { state: "pending" | "done" | "failed"; message: string }
type Attempts = Map<string, Status>
const shared = globalThis as typeof globalThis & {
  scientistFlowSignIns?: Attempts
}
const attempts = (shared.scientistFlowSignIns ??= new Map())
export const signInStatus = (id: string) =>
  attempts.get(id) ?? {
    state: "failed",
    message: "This sign-in expired. Start again.",
  }
export async function startAuthorization(
  prior: Registration | null,
  enablePlan: boolean,
  accept: (profile: Registration) => Promise<void>
) {
  const host = await hostIdentifier(),
    attempt = random()
  let state = random(),
    nonce = random(),
    verifier = random(),
    launch = random()
  let issuedClient = prior?.clientId,
    retried = false
  const status: Status = {
    state: "pending",
    message: "Waiting for ChatGPT sign-in.",
  }
  let consumed = false,
    launched = false
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader("Content-Security-Policy", "default-src 'none'")
    res.setHeader("X-Content-Type-Options", "nosniff")
    if (req.method !== "GET" || req.headers.host !== new URL(callback).host) {
      res.writeHead(400).end()
      return
    }
    const url = URL.parse(req.url ?? "/", callback)
    if (!url || url.origin !== new URL(callback).origin) {
      res.writeHead(400).end()
      return
    }
    if (url.pathname === "/start/" + launch && !launched) {
      launched = true
      const q = new URLSearchParams({
        client_id: issuedClient ?? "dynamic_agent_client",
        ext_agent_host_id: host,
        response_type: "code",
        redirect_uri: callback,
        scope: scopes,
        resource,
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      })
      if (!issuedClient) q.set("agent_name_hint", "ScientistFlow")
      if (prior?.tokens?.id) q.set("id_token_hint", prior.tokens.id)
      if (prior?.email) q.set("login_hint", prior.email)
      if (prior && enablePlan) q.set("prompt", "consent")
      res
        .writeHead(302, { Location: issuer + "/api/accounts/authorize?" + q })
        .end()
      return
    }
    if (
      url.pathname !== "/auth/callback" ||
      url.searchParams.get("state") !== state ||
      consumed
    ) {
      res.writeHead(400).end("Invalid or expired sign-in.")
      return
    }
    consumed = true
    try {
      if (url.searchParams.has("error"))
        throw new ModelConnectionError(
          "ChatGPT sign-in was declined or cancelled."
        )
      const returned = url.searchParams.get("client_id"),
        clientId = returned ?? issuedClient,
        code = url.searchParams.get("code")
      if (
        !code ||
        !clientId ||
        clientId === "dynamic_agent_client" ||
        (issuedClient && clientId !== issuedClient)
      )
        throw new ModelConnectionError(
          "The registration did not match this connection."
        )
      issuedClient = clientId
      let tokens
      try {
        tokens = await exchange({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: callback,
        })
      } catch (e) {
        if (!(e instanceof ChatGrantError) || e.state !== "invalid" || retried)
          throw e
        retried = true
        state = random()
        nonce = random()
        verifier = random()
        launch = random()
        consumed = false
        launched = false
        res
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(
            '<p>Your sign-in code expired. <a href="/start/' +
              launch +
              '">Retry ChatGPT sign-in</a> for this registration.</p>'
          )
        return
      }
      if (!tokens.id_token)
        throw new ModelConnectionError("Missing identity token.")
      const identity = await verifiedIdentity(
        tokens.id_token,
        clientId,
        nonce,
        prior?.subject
      )
      if (status.state !== "pending")
        throw new ModelConnectionError("Sign-in expired. Start again.")
      await accept({
        clientId,
        ...identity,
        tokens: {
          access: tokens.access_token,
          refresh: tokens.refresh_token,
          id: tokens.id_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean),
        },
      })
      status.state = "done"
      status.message = "ChatGPT sign-in completed. Return to ScientistFlow."
    } catch (e) {
      status.state = "failed"
      status.message =
        e instanceof ModelConnectionError
          ? e.message
          : "Could not verify or save this authorization. Start sign-in again."
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8")
    res.end(status.message)
    server.close()
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string")
    throw new ModelConnectionError("Could not open the local sign-in listener.")
  const callback = "http://127.0.0.1:" + address.port + "/auth/callback"
  attempts.set(attempt, status)
  const expiration = setTimeout(() => {
    if (status.state === "pending") {
      consumed = true
      status.state = "failed"
      status.message = "Sign-in expired. Start again."
    }
    server.close()
    attempts.delete(attempt)
  }, 15 * 60_000)
  expiration.unref()
  return { attempt, startUrl: new URL("/start/" + launch, callback).href }
}
