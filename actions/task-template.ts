"use server"

import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { taskTemplateFormSchema, taskTemplates } from "@/db/schema"
import { db } from "@/lib/db"
import { isTemplateVersionInUse } from "@/lib/skill-constraint"

type WriteResult =
  { success: true; id: string } | { success: false; error: string }

export async function saveTaskTemplate(
  id: string | null,
  input: unknown
): Promise<WriteResult> {
  const target = z.nanoid().nullable().safeParse(id)
  if (!target.success) return { success: false, error: "Invalid template ID." }
  const parsed = taskTemplateFormSchema.safeParse(input)
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0].message }

  try {
    const fields = { id: taskTemplates.id }
    const [row] = await (target.data === null
      ? db.insert(taskTemplates).values(parsed.data).returning(fields)
      : db
          .update(taskTemplates)
          .set({ ...parsed.data, updatedAt: sql`now()` })
          .where(eq(taskTemplates.id, target.data))
          .returning(fields))
    return row
      ? { success: true, id: row.id }
      : { success: false, error: "This template no longer exists." }
  } catch {
    return {
      success: false,
      error: "Could not save this template. Please try again.",
    }
  }
}

export async function deleteTaskTemplate(id: string): Promise<WriteResult> {
  const target = z.nanoid().safeParse(id)
  if (!target.success) return { success: false, error: "Invalid template ID." }
  try {
    const [row] = await db
      .delete(taskTemplates)
      .where(eq(taskTemplates.id, target.data))
      .returning({ id: taskTemplates.id })
    return row
      ? { success: true, id: row.id }
      : { success: false, error: "This template no longer exists." }
  } catch (error) {
    if (isTemplateVersionInUse(error))
      return {
        success: false,
        error: "A task is using a published version of this template.",
      }
    return {
      success: false,
      error: "Could not delete this template. Please try again.",
    }
  }
}
