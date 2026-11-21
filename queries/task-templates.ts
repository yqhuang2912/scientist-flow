"use server"

import { asc, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import {
  bots,
  taskTemplates,
  taskTemplateVersions as versions,
} from "@/db/schema"
import { emptyWorkflowDraft } from "@/lib/workflow-draft"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import { db } from "@/lib/db"

export async function getWorkflowEditorData(templateId: string) {
  await assertInstallationRequest()
  if (!z.nanoid().safeParse(templateId).success) return null
  const [[template], availableBots, [latestRelease]] = await Promise.all([
    db
      .select({
        id: taskTemplates.id,
        name: taskTemplates.name,
        draft: taskTemplates.workflowDraft,
        revision: taskTemplates.draftRevision,
      })
      .from(taskTemplates)
      .where(eq(taskTemplates.id, templateId)),
    db
      .select({
        id: bots.id,
        name: bots.name,
        job: bots.job,
        avatar: bots.avatar,
      })
      .from(bots)
      .orderBy(asc(bots.name), asc(bots.id)),
    db
      .select({ version: versions.version, revision: versions.draftRevision })
      .from(versions)
      .where(eq(versions.templateId, templateId))
      .orderBy(desc(versions.version))
      .limit(1),
  ])
  if (!template) return null
  return {
    templateId: template.id,
    name: template.name,
    revision: template.revision,
    draft: template.draft ?? emptyWorkflowDraft,
    bots: availableBots,
    latestRelease: latestRelease ?? null,
  }
}

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
