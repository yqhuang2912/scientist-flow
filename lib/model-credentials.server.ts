import "server-only"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export class ModelConnectionError extends Error {}
export function installationOwner() {
  const owner = process.env.SCIENTISTFLOW_INSTALLATION_ID
  if (!owner || !/^[a-zA-Z0-9_-]{16,100}$/.test(owner))
    throw new ModelConnectionError(
      "Configure the local installation ID before using model connections."
    )
  return owner
}
function masterKey() {
  const key = Buffer.from(
    process.env.SCIENTISTFLOW_MODEL_MASTER_KEY ?? "",
    "base64"
  )
  if (key.length !== 32)
    throw new ModelConnectionError(
      "Configure the model encryption key on the app and worker."
    )
  return key
}
export function sealCredential(owner: string, id: string, value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv)
  cipher.setAAD(Buffer.from(JSON.stringify([owner, id])))
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64"))
    .join(".")
}
export function openCredential(owner: string, id: string, sealed: string) {
  const key = masterKey()
  try {
    const parts = sealed.split(".")
    if (parts.length !== 3) throw new Error("Invalid encrypted credential")
    const [iv, tag, body] = parts.map((v) => Buffer.from(v, "base64"))
    if (iv.length !== 12 || tag.length !== 16)
      throw new Error("Invalid encrypted credential")
    const cipher = createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: 16,
    })
    cipher.setAAD(Buffer.from(JSON.stringify([owner, id])))
    cipher.setAuthTag(tag)
    return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8")
  } catch {
    throw new ModelConnectionError(
      "Could not unlock this connection. Check the installation key or replace the credential."
    )
  }
}
