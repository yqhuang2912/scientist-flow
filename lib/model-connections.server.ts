import "server-only"
import { and, asc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { bots, chatMembers, modelConnections as table } from "../db/schema"
import { db } from "./db"
import {
  choiceProblem,
  gatewayBaseUrlSchema,
  openRouterBaseUrl,
  modelChoiceSchema,
  type ModelChoice,
  type ConnectionState,
  type CatalogModel,
} from "./model-catalog"
import {
  installationOwner,
  ModelConnectionError,
  openCredential,
  sealCredential,
} from "./model-credentials.server"
import { chatCatalog } from "./chatgpt-catalog.server"
import {
  startAuthorization,
  ChatGrantError,
  planScope,
  revokeProfile,
  accessForProfile,
} from "./chatgpt-oauth.server"
import {
  withRegistration,
  storeRegistration,
  clearLocalTokens,
} from "./chatgpt-vault.server"
import { accountCatalog, CatalogError } from "./gateway-catalog.server"

const publicColumns = {
  provider: table.provider,
  id: table.id,
  nickname: table.nickname,
  baseUrl: table.baseUrl,
  revision: table.revision,
  state: table.state,
  catalog: table.catalog,
}
const owned = (id: string) =>
  and(eq(table.owner, installationOwner()), eq(table.id, id))
export async function chatMemberChoice(chatId: string, botId: string) {
  const [member] = await db
    .select({ choice: bots.modelChoice })
    .from(chatMembers)
    .innerJoin(bots, eq(bots.id, chatMembers.botId))
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.botId, botId)))
  if (!member)
    throw new ModelConnectionError("This bot is not a member of the chat.")
  const result = modelChoiceSchema.safeParse(member.choice)
  if (!result.success)
    throw new ModelConnectionError(
      "Open this bot’s settings and select an available model."
    )
  return result.data
}
export async function listConnections() {
  if (!process.env.SCIENTISTFLOW_INSTALLATION_ID) return []
  const connections = await db
    .select(publicColumns)
    .from(table)
    .where(eq(table.owner, installationOwner()))
    .orderBy(asc(table.nickname))
  const bound = await db
    .select({ name: bots.name, choice: bots.modelChoice })
    .from(bots)
    .orderBy(asc(bots.name))
  return connections.map((c) => {
    const members = bound.filter((b) => b.choice?.connectionId === c.id)
    return {
      ...c,
      baseUrl: c.provider === "openrouter" ? openRouterBaseUrl : c.baseUrl,
      usedBy: members.map((b) => b.name),
      needsModelChange:
        c.state === "ready"
          ? members
              .filter((b) => b.choice && choiceProblem(b.choice, c))
              .map((b) => b.name)
          : [],
    }
  })
}
export async function validateChoice(choice: ModelChoice) {
  const [connection] = await db
    .select(publicColumns)
    .from(table)
    .where(owned(choice.connectionId))
  const problem = choiceProblem(choice, connection)
  if (problem) throw new ModelConnectionError(problem)
}
const stale = () =>
  new ModelConnectionError("The connection changed. Reopen it and try again.")
async function change(
  id: string,
  revision: string,
  values: Partial<
    Pick<
      typeof table.$inferInsert,
      "credential" | "state" | "nickname" | "catalog" | "baseUrl" | "provider"
    >
  >
) {
  const rows = await db
    .update(table)
    .set({ ...values, revision: nanoid() })
    .where(and(owned(id), eq(table.revision, revision)))
    .returning({ id: table.id })
  if (!rows.length) throw stale()
}
function gatewayConfig(row: typeof table.$inferSelect) {
  if (row.provider !== "openrouter" && row.provider !== "gateway") throw stale()
  const legacy = row.provider === "openrouter"
  const baseUrl = legacy
    ? openRouterBaseUrl
    : gatewayBaseUrlSchema.parse(row.baseUrl)
  const keyContext = legacy ? row.id : JSON.stringify([row.id, baseUrl])
  return {
    baseUrl,
    apiKey: row.credential
      ? openCredential(row.owner, keyContext, row.credential)
      : null,
  }
}
export async function connect(
  input: { baseUrl: string; apiKey: string },
  target?: { id: string; revision: string }
) {
  const owner = installationOwner()
  const baseUrl = gatewayBaseUrlSchema.parse(input.baseUrl)
  let key = input.apiKey || null
  if (target) {
    const [row] = await db.select().from(table).where(owned(target.id))
    if (!row || row.revision !== target.revision || row.provider === "chatgpt")
      throw stale()
    if (!key && row.credential) {
      const saved = gatewayConfig(row)
      if (saved.baseUrl !== baseUrl)
        throw new ModelConnectionError(
          "Enter a new API key when changing the base URL."
        )
      key = saved.apiKey
    }
  }
  const id = target?.id ?? nanoid()
  const credential = key
    ? sealCredential(owner, JSON.stringify([id, baseUrl]), key)
    : null
  const catalog = await accountCatalog(baseUrl, key)
  const state: ConnectionState = catalog.length ? "ready" : "empty"
  const values = {
    provider: "gateway" as const,
    nickname: new URL(baseUrl).host,
    baseUrl,
    credential,
    catalog,
    state,
  }
  if (target) await change(id, target.revision, values)
  else
    await db.insert(table).values({ ...values, id, owner, revision: nanoid() })
}
export async function refreshConnection(id: string, revision: string) {
  const [row] = await db.select().from(table).where(owned(id))
  if (!row || row.revision !== revision || row.state === "disconnected")
    throw stale()
  if (row.provider === "chatgpt") {
    if (!row.credential) throw stale()
    try {
      const catalog = await chatCatalog(await accessForProfile(row.credential))
      await change(id, revision, {
        catalog,
        state: catalog.length ? "ready" : "empty",
      })
    } catch (e) {
      if (e instanceof ChatGrantError)
        await change(id, revision, { state: e.state, catalog: [] })
      throw e
    }
    return
  }
  const { baseUrl, apiKey } = gatewayConfig(row)
  try {
    const catalog = await accountCatalog(baseUrl, apiKey)
    await change(id, revision, {
      catalog,
      state: catalog.length ? "ready" : "empty",
    })
  } catch (error) {
    if (error instanceof CatalogError)
      await change(id, revision, { catalog: [], state: error.state })
    throw error
  }
}
export async function disconnectConnection(id: string, revision: string) {
  const [row] = await db.select().from(table).where(owned(id))
  if (!row || row.revision !== revision) throw stale()
  if (row.provider === "chatgpt" && row.credential) {
    await change(id, revision, { state: "disconnected", catalog: [] })
    if (!(await revokeProfile(row.credential)))
      throw new ModelConnectionError(
        "Disconnected locally. Confirm revocation in ChatGPT Settings."
      )
    return
  }
  return change(id, revision, {
    credential: null,
    catalog: [],
    state: "disconnected",
  })
}
export async function resolveConnection(choice: ModelChoice) {
  const [row] = await db.select().from(table).where(owned(choice.connectionId))
  const problem = choiceProblem(choice, row)
  if (problem || !row)
    throw new ModelConnectionError(
      problem ?? "This connection is disconnected."
    )
  const effort =
    row.catalog.find((m) => m.id === choice.modelId)?.fixedEffort ??
    choice.effort
  if (row.provider === "chatgpt") {
    if (!row.credential)
      throw new ModelConnectionError("Reconnect this ChatGPT account.")
    return {
      provider: "chatgpt" as const,
      ref: row.credential,
      effort,
      revision: row.revision,
    }
  }
  return {
    provider: "gateway" as const,
    effort,
    ...gatewayConfig(row),
    revision: row.revision,
  }
}
export async function assertCurrentConnection(id: string, revision: string) {
  const [current] = await db
    .select({ revision: table.revision })
    .from(table)
    .where(and(owned(id), eq(table.state, "ready")))
  if (current?.revision !== revision)
    throw new ModelConnectionError(
      "This connection changed or was disconnected. Send a new message after checking Settings."
    )
}

export async function invalidateCredential(id: string, revision: string) {
  // A delayed 401 from an old request cannot disable a replacement key.
  await db
    .update(table)
    .set({ state: "invalid", catalog: [], revision: nanoid() })
    .where(and(owned(id), eq(table.revision, revision)))
}

export async function setConnectionState(
  id: string,
  revision: string,
  state: ConnectionState
) {
  await db
    .update(table)
    .set({ state, revision: nanoid() })
    .where(and(owned(id), eq(table.revision, revision)))
}
export async function renameConnection(
  id: string,
  revision: string,
  nickname: string
) {
  // Display names can change between model steps without invalidating the grant.
  const rows = await db
    .update(table)
    .set({ nickname })
    .where(
      and(
        owned(id),
        eq(table.provider, "chatgpt"),
        eq(table.revision, revision)
      )
    )
    .returning({ id: table.id })
  if (!rows.length) throw stale()
}
export async function beginChatGPT(
  nickname: string,
  target?: { id: string; revision: string }
) {
  const owner = installationOwner(),
    id = target?.id ?? nanoid()
  const [row] = target ? await db.select().from(table).where(owned(id)) : []
  if (
    target &&
    (!row ||
      row.revision !== target.revision ||
      row.provider !== "chatgpt" ||
      !row.credential)
  )
    throw stale()
  const prior = row?.credential
    ? await withRegistration(row.credential, async (v) => v)
    : null
  return startAuthorization(
    prior,
    row?.state === "identity-only",
    async (profile) => {
      const ref = nanoid()
      let catalog: CatalogModel[] = [],
        state: ConnectionState = "identity-only"
      if (profile.tokens?.scopes.includes(planScope)) {
        try {
          catalog = await chatCatalog(profile.tokens.access)
          state = catalog.length ? "ready" : "empty"
        } catch (e) {
          state = e instanceof ChatGrantError ? e.state : "catalog-error"
        }
      }
      await storeRegistration(ref, profile)
      const values = { credential: ref, catalog, state }
      if (target) {
        try {
          await change(id, target.revision, values)
        } catch (e) {
          if (e instanceof ModelConnectionError) await clearLocalTokens(ref)
          throw e
        }
        if (row?.credential) await clearLocalTokens(row.credential)
      } else
        await db.insert(table).values({
          ...values,
          id,
          owner,
          nickname,
          provider: "chatgpt",
          revision: nanoid(),
        })
    }
  )
}
