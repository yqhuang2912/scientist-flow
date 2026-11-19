import "server-only"
import { mkdir, open, chmod } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import {
  installationOwner,
  ModelConnectionError,
  openCredential,
  sealCredential,
} from "./model-credentials.server"

export interface Registration {
  clientId: string
  subject: string
  email?: string
  tokens: {
    access: string
    refresh?: string
    id: string
    expiresAt: number
    scopes: string[]
  } | null
}
export function installationProfileDirectory() {
  const base =
    process.env.SCIENTISTFLOW_PROFILE_DIR ||
    path.join(
      process.env.LOCALAPPDATA || path.join(homedir(), ".config"),
      "ScientistFlow",
      "profiles"
    )
  return path.join(base, installationOwner())
}
const missing = () =>
  new ModelConnectionError(
    "Start the local ScientistFlow worker on the computer where this ChatGPT account was connected."
  )
async function database(name: string, create: boolean) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name))
    throw new Error("Invalid profile reference")
  const dir = installationProfileDirectory(),
    file = path.join(dir, name + ".sqlite")
  if (create) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const handle = await open(file, "a", 0o600)
    await handle.close()
    if (process.platform !== "win32") await chmod(file, 0o600)
  } else {
    const handle = await open(file, "r").catch(() => {
      throw missing()
    })
    await handle.close()
  }
  return new DatabaseSync(file)
}

// SQLite releases the reservation on process exit. Never break a live lock on
// a timer: two workers must not use the same rotating refresh token.
async function locked<T>(
  name: string,
  create: boolean,
  run: (db: DatabaseSync) => Promise<T>
) {
  const db = await database(name, create)
  try {
    const deadline = Date.now() + 45_000
    for (;;) {
      try {
        db.exec("BEGIN IMMEDIATE")
        break
      } catch (e) {
        if ((e as { errcode?: number }).errcode !== 5 || Date.now() > deadline)
          throw e
        await delay(60)
      }
    }
    db.exec(
      "CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)"
    )
    const value = await run(db)
    db.exec("COMMIT")
    return value
  } finally {
    db.close()
  }
}
export function hostIdentifier() {
  return locked("host", true, async (db) => {
    db.prepare("INSERT OR IGNORE INTO profile VALUES(1,?)").run(
      "urn:uuid:" + randomUUID()
    )
    return String(db.prepare("SELECT value FROM profile").get()!.value)
  })
}
export function withRegistration<T>(
  ref: string,
  run: (value: Registration, save: (v: Registration) => void) => Promise<T>
) {
  return locked(ref, false, async (db) => {
    const raw = db.prepare("SELECT value FROM profile").get()
    if (!raw) throw missing()
    const owner = installationOwner()
    const value = JSON.parse(
      openCredential(owner, ref, String(raw.value))
    ) as Registration
    return run(value, (v) =>
      db
        .prepare("UPDATE profile SET value=? WHERE id=1")
        .run(sealCredential(owner, ref, JSON.stringify(v)))
    )
  })
}
export async function storeRegistration(ref: string, value: Registration) {
  await locked(ref, true, async (db) => {
    db.prepare("INSERT INTO profile VALUES(1,?)").run(
      sealCredential(installationOwner(), ref, JSON.stringify(value))
    )
  })
}
export function clearLocalTokens(ref: string) {
  return withRegistration(ref, async (value, save) => {
    save({ ...value, tokens: null })
  })
}
