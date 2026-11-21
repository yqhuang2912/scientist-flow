"use server"

import { and, eq, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"
import {
  bots,
  taskTemplates,
  taskTemplateVersions as versions,
} from "@/db/schema"
import {
  currentTemplateVersion,
  draftIsPublished,
  versionStateFields,
} from "@/lib/template-history.server"
import { db } from "@/lib/db"
import { assertInstallationRequest } from "@/lib/installation-request.server"

export async function publishTemplateVersion(
  templateId: string,
  revision: number
) {
  await assertInstallationRequest()
  if (
    !z.nanoid().safeParse(templateId).success ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    return {
      success: false as const,
      error: "Save the workflow before publishing.",
    }
  try {
    // Each statement sees the committed state after acquiring the parent row lock.
    // Two editors publishing the same revision receive the same release.
    const [, , , rows] = await db.batch([
      db
        .select({ id: taskTemplates.id })
        .from(taskTemplates)
        .where(eq(taskTemplates.id, templateId))
        .for("update"),
      db.execute(sql`
        insert into ${versions} (id, template_id, version, draft_revision, name, workflow, parent_version)
        select ${nanoid()}, ${taskTemplates.id},
          (select coalesce(max(${versions.version}), 0) + 1 from ${versions} where ${versions.templateId} = ${templateId}),
          ${taskTemplates.draftRevision}, ${taskTemplates.name}, ${taskTemplates.workflowDraft}, ${currentTemplateVersion}
        from ${taskTemplates}
        where ${taskTemplates.id} = ${templateId} and ${taskTemplates.draftRevision} = ${revision}
          and not ${draftIsPublished}
          and jsonb_array_length(${taskTemplates.workflowDraft}->'nodes') > 0
          and not exists (
            select 1 from jsonb_array_elements(${taskTemplates.workflowDraft}->'nodes') step
            where case when step ? 'botId' then
              not exists (select 1 from ${bots} where ${bots.id} = step->>'botId')
            else coalesce(jsonb_array_length(step->'mentions'), 0) = 0 or exists (
              select 1 from jsonb_array_elements(step->'mentions') mention
              where not exists (select 1 from ${bots} where ${bots.id} = mention->>'value')
            ) end
          )
        on conflict (template_id, draft_revision) do nothing
      `),
      db.execute(sql`
        update ${taskTemplates} set current_version = r.version
        from ${versions} r where task_templates.id = ${templateId}
          and task_templates.draft_revision = ${revision}
          and r.template_id = task_templates.id and r.draft_revision = ${revision}
      `),
      db
        .select(versionStateFields)
        .from(taskTemplates)
        .where(
          and(
            eq(taskTemplates.id, templateId),
            eq(taskTemplates.draftRevision, revision)
          )
        ),
    ])
    return rows[0]?.draftPublished
      ? { success: true as const, state: rows[0] }
      : {
          success: false as const,
          error:
            "Could not publish this revision. Each node needs an available @bot. Check the latest draft and try again.",
        }
  } catch {
    return {
      success: false as const,
      error: "Could not publish the template. Please try again.",
    }
  }
}

export async function switchTemplateVersion(
  templateId: string,
  version: number,
  revision: number
) {
  await assertInstallationRequest()
  if (
    !z.nanoid().safeParse(templateId).success ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    return { success: false as const, error: "Invalid workflow version." }
  }
  try {
    // The target snapshot is always resolved inside this template. Updating the
    // revision also invalidates saves from editors still on the previous base.
    const [, [row]] = await db.batch([
      db
        .update(taskTemplates)
        .set({
          currentVersion: versions.version,
          workflowDraft: versions.workflow,
          draftRevision: sql`${taskTemplates.draftRevision} + 1`,
          updatedAt: sql`now()`,
        })
        .from(versions)
        .where(
          and(
            eq(taskTemplates.id, templateId),
            eq(taskTemplates.draftRevision, revision),
            eq(versions.templateId, templateId),
            eq(versions.version, version),
            sql`${currentTemplateVersion} is distinct from ${version}`
          )
        ),
      db
        .select({
          ...versionStateFields,
          draft: taskTemplates.workflowDraft,
          revision: taskTemplates.draftRevision,
        })
        .from(taskTemplates)
        .where(
          and(
            eq(taskTemplates.id, templateId),
            eq(taskTemplates.draftRevision, revision + 1),
            eq(taskTemplates.currentVersion, version)
          )
        ),
    ])
    if (row?.draft && row.draftPublished) {
      const { draft, revision: nextRevision, ...state } = row
      return { success: true as const, draft, revision: nextRevision, state }
    }
    return {
      success: false as const,
      error:
        "The template changed or this version is unavailable. Reopen the workflow and try again.",
    }
  } catch {
    return {
      success: false as const,
      error: "Could not switch versions. Please try again.",
    }
  }
}
