import "server-only"
import { and, asc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { bots, chatMembers, modelConnections as table } from "../db/schema"
import { db } from "./db"
import {
  choiceProblem,
  modelChoiceSchema,
  type ModelChoice,
  type ConnectionState,
} from "./model-catalog"
import {
  installationOwner,
  ModelConnectionError,
  openCredential,
  sealCredential,
} from "./model-credentials.server"
import { accountCatalog, CatalogError } from "./openrouter-catalog.server"

const publicColumns = {
  id: table.id,
  nickname: table.nickname,
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
  return db
    .select(publicColumns)
    .from(table)
    .where(eq(table.owner, installationOwner()))
    .orderBy(asc(table.nickname))
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
      "credential" | "state" | "nickname" | "catalog"
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
export async function connect(
  input: { nickname: string; apiKey: string },
  target?: { id: string; revision: string }
) {
  const owner = installationOwner()
  if (target) {
    const [row] = await db
      .select({ revision: table.revision })
      .from(table)
      .where(owned(target.id))
    if (row?.revision !== target.revision) throw stale()
  }
  const id = target?.id ?? nanoid()
  const credential = sealCredential(owner, id, input.apiKey)
  const catalog = await accountCatalog(input.apiKey)
  const state: ConnectionState = catalog.length ? "ready" : "empty"
  const values = { nickname: input.nickname, credential, catalog, state }
  if (target) await change(id, target.revision, values)
  else
    await db.insert(table).values({ ...values, id, owner, revision: nanoid() })
}
export async function refreshConnection(id: string, revision: string) {
  const [row] = await db.select().from(table).where(owned(id))
  if (!row?.credential || row.revision !== revision) throw stale()
  const key = openCredential(row.owner, id, row.credential)
  try {
    const catalog = await accountCatalog(key)
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
export function disconnectConnection(id: string, revision: string) {
  return change(id, revision, {
    credential: null,
    catalog: [],
    state: "disconnected",
  })
}
export async function resolveConnection(choice: ModelChoice) {
  const [row] = await db.select().from(table).where(owned(choice.connectionId))
  const problem = choiceProblem(choice, row)
  if (problem || !row?.credential)
    throw new ModelConnectionError(
      problem ?? "This connection is disconnected."
    )
  return {
    apiKey: openCredential(row.owner, row.id, row.credential),
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
