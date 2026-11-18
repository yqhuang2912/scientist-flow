"use server"

import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { toolDefinitions } from "@/db/schema"
import { toolDefinitionSchema } from "@/db/tool-form-schema"
import { db } from "@/lib/db"
import type { ToolResult } from "@/lib/tool-definition"

import { isToolReferenceError } from "@/lib/skill-constraint"

type WriteResult = ToolResult<{ id: string }>

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
        error: "A tool with this identifier already exists.",
      }
    }
  }
  return {
    success: false,
    error: "Could not save this tool. Please try again.",
  }
}

export async function createTool(input: unknown): Promise<WriteResult> {
  const parsed = toolDefinitionSchema.safeParse(input)
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0].message }
  try {
    const [row] = await db
      .insert(toolDefinitions)
      .values(parsed.data)
      .returning({ id: toolDefinitions.id })
    return { success: true, data: row }
  } catch (error) {
    return writeError(error)
  }
}

export async function updateTool(
  id: unknown,
  input: unknown
): Promise<WriteResult> {
  const target = z.nanoid().safeParse(id)
  if (!target.success) return { success: false, error: "Invalid tool ID." }
  const parsed = toolDefinitionSchema.safeParse(input)
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0].message }
  try {
    const [row] = await db
      .update(toolDefinitions)
      .set({ ...parsed.data, updatedAt: sql`now()` })
      .where(eq(toolDefinitions.id, target.data))
      .returning({ id: toolDefinitions.id })
    return row
      ? { success: true, data: row }
      : { success: false, error: "This tool no longer exists." }
  } catch (error) {
    return writeError(error)
  }
}

export async function deleteTool(id: unknown): Promise<WriteResult> {
  const target = z.nanoid().safeParse(id)
  if (!target.success) return { success: false, error: "Invalid tool ID." }
  try {
    const [row] = await db
      .delete(toolDefinitions)
      .where(eq(toolDefinitions.id, target.data))
      .returning({ id: toolDefinitions.id })
    return row
      ? { success: true, data: row }
      : { success: false, error: "This tool no longer exists." }
  } catch (error) {
    if (isToolReferenceError(error))
      return {
        success: false,
        error: "This tool is in use by a bot. Unbind it before deleting.",
      }
    return {
      success: false,
      error: "Could not delete this tool. Please try again.",
    }
  }
}
