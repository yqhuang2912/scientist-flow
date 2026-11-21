"use server"

import { asc, desc, sql } from "drizzle-orm"
import { taskTemplates, taskTemplateVersions as versions } from "@/db/schema"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import { db } from "@/lib/db"

export async function getPublishedTemplates() {
  await assertInstallationRequest()
  try {
    const rows = await db
      .select({
        id: versions.id,
        name: versions.name,
        version: versions.version,
        botIds: sql<
          string[]
        >`jsonb_path_query_array(${versions.workflow}, '$.nodes[*].botId')`,
      })
      .from(versions)
      .orderBy(asc(versions.name), desc(versions.version))
    return { success: true as const, data: rows }
  } catch {
    return {
      success: false as const,
      error: "Could not load published templates.",
    }
  }
}

export async function getTaskTemplates() {
  try {
    const rows = await db
      .select({
        id: taskTemplates.id,
        name: taskTemplates.name,
        description: taskTemplates.description,
      })
      .from(taskTemplates)
      .orderBy(
        desc(taskTemplates.updatedAt),
        asc(taskTemplates.name),
        asc(taskTemplates.id)
      )
    return { success: true as const, data: rows }
  } catch {
    return { success: false as const, error: "Could not load templates." }
  }
}
