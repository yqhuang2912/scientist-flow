"use server"

import { desc, eq, asc } from "drizzle-orm"
import { z } from "zod"
import { skills, type SkillSummary, type Skill } from "@/db/schema"
import { db } from "@/lib/db"
import type { SkillResult } from "@/lib/skill-definition"

export async function getSkills(): Promise<SkillResult<SkillSummary[]>> {
  try {
    const rows = await db
      .select({
        id: skills.id,
        displayName: skills.displayName,
        name: skills.name,
        description: skills.description,
        updatedAt: skills.updatedAt,
      })
      .from(skills)
      .orderBy(desc(skills.updatedAt), asc(skills.name))
    return { success: true, data: rows }
  } catch {
    return { success: false, error: "Could not load shared skills." }
  }
}

export async function getSkill(id: unknown): Promise<SkillResult<Skill>> {
  const parsed = z.nanoid().safeParse(id)
  if (!parsed.success) return { success: false, error: "Invalid skill ID." }
  try {
    const [row] = await db
      .select()
      .from(skills)
      .where(eq(skills.id, parsed.data))
      .limit(1)
    return row
      ? { success: true, data: row }
      : { success: false, error: "This skill no longer exists." }
  } catch {
    return { success: false, error: "Could not load this skill." }
  }
}
