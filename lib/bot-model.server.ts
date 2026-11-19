import "server-only"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { modelRequests } from "../db/schema"
import { db } from "./db"

import {
  chatMemberChoice,
  assertCurrentConnection,
  invalidateCredential,
  resolveConnection,
} from "./model-connections.server"

import { openRouterStep } from "./openrouter-step.server"

export async function resolveBotModel(
  chatId: string,
  botId: string,
  runId: string,
  executionId: string
) {
  const choice = await chatMemberChoice(chatId, botId)
  const connection = await resolveConnection(choice)
  return (step: number) =>
    openRouterStep({
      apiKey: connection.apiKey,
      modelId: choice.modelId,
      effort: choice.effort,
      authorize: async () => {
        await assertCurrentConnection(choice.connectionId, connection.revision)
      },
      record: async (fields) => {
        const id = nanoid()
        await db.insert(modelRequests).values({
          id,
          chatId,
          botId,
          runId,
          step,
          executionId,
          ...fields,
          connection: choice.connectionId.slice(-8),
          revision: connection.revision.slice(-8),
        })
        if (fields.httpStatus === 401)
          await invalidateCredential(choice.connectionId, connection.revision)
        return id
      },
      response: async (id, fields) => {
        await db
          .update(modelRequests)
          .set(fields)
          .where(eq(modelRequests.id, id))
      },
    })
}
