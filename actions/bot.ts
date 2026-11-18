"use server"

import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { createHash } from "node:crypto"
import { z } from "zod"

import { db } from "@/lib/db"
import {
  botFormSchema,
  bots,
  chatMembers,
  chats,
  skills,
  botSkills,
  botTools,
  toolDefinitions,
} from "@/db/schema"
import { createDevPodSandboxId, deleteDevPodSandbox } from "@/lib/devpod"
import {
  isSkillReferenceError,
  isToolReferenceError,
} from "@/lib/skill-constraint"

type CreateBotResult =
  | {
      success: true
      bot: typeof bots.$inferSelect
      chat: typeof chats.$inferSelect
      chatMember: typeof chatMembers.$inferSelect
    }
  | { success: false; error: string }

type UpdateBotResult =
  | { success: true; bot: typeof bots.$inferSelect }
  | { success: false; error: string }

type DeleteBotResult = { success: true } | { success: false; error: string }

const missingSkill = {
  success: false as const,
  error:
    "A selected skill no longer exists. Reopen the form to refresh the list.",
}

async function skillsExist(ids: string[]) {
  if (!ids.length) return true
  const rows = await db
    .select({ id: skills.id })
    .from(skills)
    .where(inArray(skills.id, ids))
  return rows.length === ids.length
}

const missingTool = {
  success: false as const,
  error:
    "A selected tool no longer exists. Reopen the form to refresh the list.",
}

async function missingBinding(skillIds: string[], toolIds: string[]) {
  const [validSkills, selectedTools] = await Promise.all([
    skillsExist(skillIds),
    toolIds.length
      ? db
          .select({ id: toolDefinitions.id })
          .from(toolDefinitions)
          .where(inArray(toolDefinitions.id, toolIds))
      : [],
  ])
  if (!validSkills) return missingSkill
  if (selectedTools.length !== toolIds.length) return missingTool
}

function insertToolBindings(botId: string, ids: string[]) {
  return ids.length
    ? [db.insert(botTools).values(ids.map((toolId) => ({ botId, toolId })))]
    : []
}

function insertBindings(botId: string, ids: string[]) {
  return ids.length
    ? [db.insert(botSkills).values(ids.map((skillId) => ({ botId, skillId })))]
    : []
}

// One random form key identifies retries. Deriving both IDs lets an atomic
// create be recovered after a lost response without a second Bot or chat.
function creationId(key: string, scope: string) {
  return createHash("sha256")
    .update(key + ":" + scope)
    .digest("base64url")
    .slice(0, 21)
}

export async function createBot(
  input: unknown,
  requestKey: unknown = nanoid()
): Promise<CreateBotResult> {
  const parsed = botFormSchema.safeParse(input)
  const key = z.nanoid().safeParse(requestKey)
  if (!key.success)
    return { success: false, error: "Invalid creation request." }

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form fields.",
    }
  }

  const { skillIds, toolIds, ...fields } = parsed.data
  const botId = creationId(key.data, "bot")
  const chatId = creationId(
    key.data,
    JSON.stringify([fields, [...skillIds].sort(), [...toolIds].sort()])
  )
  try {
    const missing = await missingBinding(skillIds, toolIds)
    if (missing) return missing
    const sandboxId = createDevPodSandboxId(botId)
    const [botRows, chatRows, chatMemberRows] = await db.batch([
      db
        .insert(bots)
        .values({ ...fields, id: botId, sandboxId })
        .returning(),
      db
        .insert(chats)
        .values({ id: chatId, kind: "direct", name: null })
        .returning(),
      db.insert(chatMembers).values({ chatId, botId }).returning(),
      ...insertBindings(botId, skillIds),
      ...insertToolBindings(botId, toolIds),
    ])

    const bot = botRows[0]
    const chat = chatRows[0]
    const chatMember = chatMemberRows[0]

    if (!bot || !chat || !chatMember) {
      return { success: false, error: "The bot could not be created." }
    }

    return { success: true, bot, chat, chatMember }
  } catch (error) {
    if (isToolReferenceError(error)) return missingTool
    if (isSkillReferenceError(error)) return missingSkill
    const cause = error instanceof Error ? (error.cause ?? error) : error
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505"
    ) {
      try {
        const [prior] = await db
          .select({ bot: bots, chat: chats, chatMember: chatMembers })
          .from(chatMembers)
          .innerJoin(bots, eq(bots.id, chatMembers.botId))
          .innerJoin(chats, eq(chats.id, chatMembers.chatId))
          .where(and(eq(bots.id, botId), eq(chats.id, chatId)))
          .limit(1)
        if (prior) return { success: true, ...prior }
        return {
          success: false,
          error: "This form was already submitted. Reopen the bot to edit it.",
        }
      } catch {
        return {
          success: false,
          error: "Could not confirm the previous submission.",
        }
      }
    }
    console.error("Failed to create bot", error)
    return { success: false, error: "The bot could not be created." }
  }
}

export async function updateBot(
  botId: string,
  input: unknown
): Promise<UpdateBotResult> {
  if (typeof botId !== "string" || !botId.trim()) {
    return { success: false, error: "The bot could not be updated." }
  }

  const parsed = botFormSchema.safeParse(input)

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form fields.",
    }
  }

  try {
    const { skillIds, toolIds, ...fields } = parsed.data
    const missing = await missingBinding(skillIds, toolIds)
    if (missing) return missing
    // Updating the Bot first serializes concurrent full-set replacements.
    const [rows] = await db.batch([
      db
        .update(bots)
        .set({
          ...fields,
          instructions: parsed.data.instructions?.trim() || null,
        })
        .where(eq(bots.id, botId))
        .returning(),
      db.delete(botTools).where(eq(botTools.botId, botId)),
      db.delete(botSkills).where(eq(botSkills.botId, botId)),
      ...insertBindings(botId, skillIds),
      ...insertToolBindings(botId, toolIds),
    ])

    const bot = rows[0]
    if (!bot) {
      return { success: false, error: "The bot could not be updated." }
    }

    return { success: true, bot }
  } catch (error) {
    if (isToolReferenceError(error)) return missingTool
    if (isSkillReferenceError(error)) return missingSkill
    console.error("Failed to update bot", error)
    return { success: false, error: "The bot could not be updated." }
  }
}

export async function deleteBot(botId: string): Promise<DeleteBotResult> {
  if (typeof botId !== "string" || !botId.trim()) {
    return { success: false, error: "The bot could not be deleted." }
  }

  try {
    const botRows = await db
      .select({ sandboxId: bots.sandboxId })
      .from(bots)
      .where(eq(bots.id, botId))
      .limit(1)

    if (!botRows[0]) {
      return { success: false, error: "The bot could not be deleted." }
    }

    if (botRows[0].sandboxId) {
      await deleteDevPodSandbox(botRows[0].sandboxId)
    }

    const directChatRows = await db
      .select({ chatId: chats.id })
      .from(chatMembers)
      .innerJoin(chats, eq(chatMembers.chatId, chats.id))
      .where(and(eq(chatMembers.botId, botId), eq(chats.kind, "direct")))

    const deletedBots = await db
      .delete(bots)
      .where(eq(bots.id, botId))
      .returning({ id: bots.id })

    if (!deletedBots[0]) {
      return { success: false, error: "The bot could not be deleted." }
    }

    const directChatIds = directChatRows.map((row) => row.chatId)
    if (directChatIds.length > 0) {
      await db.delete(chats).where(inArray(chats.id, directChatIds))
    }

    return { success: true }
  } catch (error) {
    console.error("Failed to delete bot", error)
    return { success: false, error: "The bot could not be deleted." }
  }
}
