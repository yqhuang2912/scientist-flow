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
  setConnectionState,
} from "./model-connections.server"

import { chatGPTStep } from "./chatgpt-step.server"
import { accessForProfile } from "./chatgpt-oauth.server"
import { openRouterStep, type OutboundRecord } from "./openrouter-step.server"

export async function resolveBotModel(
  chatId: string,
  botId: string,
  runId: string,
  executionId: string
) {
  const choice = await chatMemberChoice(chatId, botId)
  const connection = await resolveConnection(choice)
  return (step: number) => {
    const common = {
      modelId: choice.modelId,
      effort: choice.effort,
      authorize: async () => {
        await assertCurrentConnection(choice.connectionId, connection.revision)
      },
      record: async (fields: OutboundRecord) => {
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
        if (fields.httpStatus === 401 && connection.provider === "openrouter")
          await invalidateCredential(choice.connectionId, connection.revision)
        return id
      },
    }
    if (connection.provider === "chatgpt")
      return chatGPTStep({
        ...common,
        effort: connection.effort,
        token: () => accessForProfile(connection.ref),
        block: (e) =>
          setConnectionState(choice.connectionId, connection.revision, e.state),
        receipt: async (id, fields) => {
          await db
            .update(modelRequests)
            .set(fields)
            .where(eq(modelRequests.id, id))
        },
      })
    return openRouterStep({
      ...common,
      apiKey: connection.apiKey,
      response: async (id, fields) => {
        await db
          .update(modelRequests)
          .set(fields)
          .where(eq(modelRequests.id, id))
      },
    })
  }
}
