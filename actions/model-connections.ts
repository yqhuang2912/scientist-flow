"use server"
import { z } from "zod"
import { connectionFormSchema } from "@/db/schema"
import {
  connect,
  disconnectConnection,
  listConnections,
  refreshConnection,
} from "@/lib/model-connections.server"
import { ModelConnectionError } from "@/lib/model-credentials.server"
import { assertInstallationRequest } from "@/lib/installation-request.server"

const targetSchema = z.object({ id: z.nanoid(), revision: z.nanoid() }).strict()
async function action<T>(run: () => Promise<T>) {
  try {
    await assertInstallationRequest()
    return { success: true as const, data: await run() }
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof ModelConnectionError
          ? error.message
          : error instanceof z.ZodError
            ? "Check the connection fields and try again."
            : "Could not access model connections. Try again.",
    }
  }
}
export async function getModelConnections() {
  if (!process.env.SCIENTISTFLOW_INSTALLATION_ID)
    return { success: true as const, data: [] }
  return action(listConnections)
}
export async function saveModelConnection(input: unknown, target?: unknown) {
  return action(() =>
    connect(
      connectionFormSchema.parse(input),
      target === undefined ? undefined : targetSchema.parse(target)
    )
  )
}
export async function updateConnectionCatalog(target: unknown) {
  return action(() => {
    const { id, revision } = targetSchema.parse(target)
    return refreshConnection(id, revision)
  })
}
export async function removeModelConnection(target: unknown) {
  return action(() => {
    const { id, revision } = targetSchema.parse(target)
    return disconnectConnection(id, revision)
  })
}
