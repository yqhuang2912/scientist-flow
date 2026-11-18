import { asc, eq } from "drizzle-orm"

import { bots, botSkills, skills, chatMembers, chats } from "../db/schema"
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

export async function getChatSkillBindings(chatId: string) {
  return db
    .select({
      botId: chatMembers.botId,
      id: skills.id,
      name: skills.name,
      description: skills.description,
      instructions: skills.instructions,
      updatedAt: skills.updatedAt,
    })
    .from(chatMembers)
    .innerJoin(botSkills, eq(chatMembers.botId, botSkills.botId))
    .innerJoin(skills, eq(botSkills.skillId, skills.id))
    .where(eq(chatMembers.chatId, chatId))
    .orderBy(asc(skills.name))
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
