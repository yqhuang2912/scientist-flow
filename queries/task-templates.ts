"use server"

import { asc, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import {
  bots,
  taskTemplates,
  taskTemplateVersions as versions,
} from "@/db/schema"
import { emptyWorkflowDraft, workflowBotIds } from "@/lib/workflow-draft"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import {
  currentTemplateVersion,
  versionStateFields,
} from "@/lib/template-history.server"
import { db } from "@/lib/db"

export async function getWorkflowEditorData(templateId: string) {
  await assertInstallationRequest()
  if (!z.nanoid().safeParse(templateId).success) return null
  const [[template], availableBots] = await Promise.all([
    db
      .select({
        id: taskTemplates.id,
        name: taskTemplates.name,
        ...versionStateFields,
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
  ])
  if (!template) return null
  return {
    templateId: template.id,
    name: template.name,
    revision: template.revision,
    draft: template.draft ?? emptyWorkflowDraft,
    bots: availableBots,
    versionState: {
      currentVersion: template.currentVersion,
      draftPublished: template.draftPublished,
      releases: template.releases,
    },
  }
}

export async function getPublishedTemplates() {
  await assertInstallationRequest()
  try {
    const rows = await db
      .select({
        id: versions.id,
        name: versions.name,
        current: sql<boolean>`${versions.version} = ${currentTemplateVersion}`,
        version: versions.version,
        workflow: versions.workflow,
      })
      .from(versions)
      .innerJoin(taskTemplates, eq(taskTemplates.id, versions.templateId))
      .orderBy(
        asc(taskTemplates.name),
        asc(taskTemplates.id),
        desc(sql`${versions.version} = ${currentTemplateVersion}`),
        desc(versions.version)
      )
    return {
      success: true as const,
      data: rows.map(({ workflow, ...r }) => ({
        ...r,
        botIds: workflowBotIds(workflow),
      })),
    }
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
