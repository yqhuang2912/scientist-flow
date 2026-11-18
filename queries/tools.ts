"use server"

import { desc, eq, asc } from "drizzle-orm"
import { z } from "zod"
import {
  bots,
  botTools,
  toolDefinitions,
  type ToolDefinition,
  type ToolSummary,
} from "@/db/schema"
import { db } from "@/lib/db"
import type { ToolResult } from "@/lib/tool-definition"

export async function getTools(): Promise<ToolResult<ToolSummary[]>> {
  try {
    const rows = await db
      .select({
        id: toolDefinitions.id,
        kind: toolDefinitions.kind,
        displayName: toolDefinitions.displayName,
        name: toolDefinitions.name,
        description: toolDefinitions.description,
        updatedAt: toolDefinitions.updatedAt,
      })
      .from(toolDefinitions)
      .orderBy(desc(toolDefinitions.updatedAt), asc(toolDefinitions.name))
    return { success: true, data: rows }
  } catch {
    return { success: false, error: "Could not load shared tools." }
  }
}

export async function getTool(
  id: unknown
): Promise<ToolResult<ToolDefinition>> {
  const parsed = z.nanoid().safeParse(id)
  if (!parsed.success) return { success: false, error: "Invalid tool ID." }
  try {
    const [row] = await db
      .select()
      .from(toolDefinitions)
      .where(eq(toolDefinitions.id, parsed.data))
      .limit(1)
    return row
      ? { success: true, data: row }
      : { success: false, error: "This tool no longer exists." }
  } catch {
    return { success: false, error: "Could not load this tool." }
  }
}
export async function getBotToolIds(
  id: unknown
): Promise<ToolResult<string[]>> {
  const target = z.nanoid().safeParse(id)
  if (!target.success) return { success: false, error: "Invalid bot ID." }
  try {
    const rows = await db
      .select({ id: botTools.toolId })
      .from(bots)
      .leftJoin(botTools, eq(bots.id, botTools.botId))
      .where(eq(bots.id, target.data))
    if (!rows.length)
      return { success: false, error: "This bot no longer exists." }
    return { success: true, data: rows.flatMap((r) => (r.id ? [r.id] : [])) }
  } catch {
    return { success: false, error: "Could not load this bot’s tools." }
  }
}
