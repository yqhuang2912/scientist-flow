"use server"

import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { skills, skillFormSchema } from "@/db/schema"
import { db } from "@/lib/db"
import type { SkillResult } from "@/lib/skill-definition"

type WriteResult = SkillResult<{ id: string }>

function writeError(error: unknown): WriteResult {
  // Drizzle wraps the PostgreSQL error from Neon in a DrizzleQueryError.
  const cause = error instanceof Error ? error.cause : null
  for (const candidate of [error, cause]) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "code" in candidate &&
      candidate.code === "23505"
    ) {
      return {
        success: false,
        error: "A skill with this identifier already exists.",
      }
    }
  }
  return {
    success: false,
    error: "Could not save this skill. Please try again.",
  }
}

export async function createSkill(input: unknown): Promise<WriteResult> {
  const parsed = skillFormSchema.safeParse(input)
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0].message }
  try {
    const [row] = await db
      .insert(skills)
      .values(parsed.data)
      .returning({ id: skills.id })
    return { success: true, data: row }
  } catch (error) {
    return writeError(error)
  }
}

export async function updateSkill(
  id: unknown,
  input: unknown
): Promise<WriteResult> {
  const target = z.nanoid().safeParse(id)
  if (!target.success) return { success: false, error: "Invalid skill ID." }
  const parsed = skillFormSchema.safeParse(input)
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0].message }
  try {
    const [row] = await db
      .update(skills)
      .set({ ...parsed.data, updatedAt: sql`now()` })
      .where(eq(skills.id, target.data))
      .returning({ id: skills.id })
    return row
      ? { success: true, data: row }
      : { success: false, error: "This skill no longer exists." }
  } catch (error) {
    return writeError(error)
  }
}

export async function deleteSkill(id: unknown): Promise<WriteResult> {
  const target = z.nanoid().safeParse(id)
  if (!target.success) return { success: false, error: "Invalid skill ID." }
  try {
    const [row] = await db
      .delete(skills)
      .where(eq(skills.id, target.data))
      .returning({ id: skills.id })
    return row
      ? { success: true, data: row }
      : { success: false, error: "This skill no longer exists." }
  } catch {
    return {
      success: false,
      error: "Could not delete this skill. Please try again.",
    }
  }
}
