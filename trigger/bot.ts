import { and, asc, eq, getTableColumns, inArray } from "drizzle-orm"

import {
  bots,
  botMemories,
  botSkills,
  skills,
  chatMembers,
  chats,
  botTools,
  toolDefinitions,
  toolPostClaims,
} from "../db/schema"
import { db } from "../lib/db"

export type TriggerBot = Pick<
  typeof bots.$inferSelect,
  "id" | "name" | "job" | "instructions"
>

export type TriggerChatContext = {
  kind: "direct" | "group"
  bots: TriggerBot[]
}

export async function getTriggerBotById(botId: string) {
  const rows = await db.select().from(bots).where(eq(bots.id, botId)).limit(1)
  return rows[0] ?? null
}

function memberSkillIds(chatId: string, botId: string) {
  return db
    .select({ id: botSkills.skillId })
    .from(chatMembers)
    .innerJoin(botSkills, eq(chatMembers.botId, botSkills.botId))
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.botId, botId)))
}

export async function getChatSkillBindings(chatId: string, botId: string) {
  const rows = await db
    .select({
      id: skills.id,
      name: skills.name,
      description: skills.description,
      updatedAt: skills.updatedAt,
    })
    .from(skills)
    .where(inArray(skills.id, memberSkillIds(chatId, botId)))
    .orderBy(asc(skills.name))
  return rows.map((row) => ({ ...row, botId }))
}

export async function readChatSkillInstructions(
  chatId: string,
  botId: string,
  skillId: string
) {
  const [row] = await db
    .select({ instructions: skills.instructions, updatedAt: skills.updatedAt })
    .from(skills)
    .where(
      and(
        eq(skills.id, skillId),
        inArray(skills.id, memberSkillIds(chatId, botId))
      )
    )
  return row
}

export async function getChatBotMemories(chatId: string, botId: string) {
  try {
    return await db
      .select({ botId: botMemories.botId, text: botMemories.text })
      .from(chatMembers)
      .innerJoin(botMemories, eq(botMemories.botId, chatMembers.botId))
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.botId, botId)))
      .orderBy(asc(botMemories.createdAt), asc(botMemories.id))
  } catch {
    console.error("Could not read bot memory for chat", chatId)
    throw new Error(
      "Could not load bot preferences. Please retry this message."
    )
  }
}

export async function getTriggerChatContext(
  chatId: string
): Promise<TriggerChatContext | null> {
  const rows = await db
    .select({
      kind: chats.kind,
      botId: bots.id,
      botName: bots.name,
      botJob: bots.job,
      botInstructions: bots.instructions,
    })
    .from(chats)
    .leftJoin(chatMembers, eq(chatMembers.chatId, chats.id))
    .leftJoin(bots, eq(chatMembers.botId, bots.id))
    .where(eq(chats.id, chatId))
    .orderBy(asc(chatMembers.joinedAt))

  const row = rows[0]
  if (!row) {
    return null
  }

  const memberBots = rows.reduce<TriggerBot[]>((allBots, currentRow) => {
    if (
      currentRow.botId &&
      currentRow.botName &&
      currentRow.botJob &&
      !allBots.some((bot) => bot.id === currentRow.botId)
    ) {
      allBots.push({
        id: currentRow.botId,
        name: currentRow.botName,
        job: currentRow.botJob,
        instructions: currentRow.botInstructions,
      })
    }
    return allBots
  }, [])

  return { kind: row.kind, bots: memberBots }
}
export function getChatToolBindings(
  chatId: string,
  member?: { botId: string; toolId?: string }
) {
  return db
    .select({
      botId: chatMembers.botId,
      botName: bots.name,
      ...getTableColumns(toolDefinitions),
    })
    .from(chatMembers)
    .innerJoin(bots, eq(bots.id, chatMembers.botId))
    .innerJoin(botTools, eq(chatMembers.botId, botTools.botId))
    .innerJoin(toolDefinitions, eq(toolDefinitions.id, botTools.toolId))
    .where(
      and(
        eq(chatMembers.chatId, chatId),
        member && eq(chatMembers.botId, member.botId),
        member?.toolId ? eq(toolDefinitions.id, member.toolId) : undefined
      )
    )
}

export async function claimToolPost(
  chatId: string,
  messageId: string,
  toolId: string,
  inputHash: string
) {
  const rows = await db
    .insert(toolPostClaims)
    .values({ chatId, messageId, toolId, inputHash })
    .onConflictDoNothing()
    .returning({ id: toolPostClaims.toolId })
  return rows.length === 1
}
