"use server"

import { and, eq, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"
import {
  bots,
  taskTemplates,
  taskTemplateVersions as versions,
} from "@/db/schema"
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
    const [, , rows] = await db.batch([
      db
        .select({ id: taskTemplates.id })
        .from(taskTemplates)
        .where(eq(taskTemplates.id, templateId))
        .for("update"),
      db.execute(sql`
        insert into ${versions} (id, template_id, version, draft_revision, name, workflow)
        select ${nanoid()}, ${taskTemplates.id},
          (select coalesce(max(${versions.version}), 0) + 1 from ${versions} where ${versions.templateId} = ${templateId}),
          ${taskTemplates.draftRevision}, ${taskTemplates.name}, ${taskTemplates.workflowDraft}
        from ${taskTemplates}
        where ${taskTemplates.id} = ${templateId} and ${taskTemplates.draftRevision} = ${revision}
          and jsonb_array_length(${taskTemplates.workflowDraft}->'nodes') > 0
          and not exists (
            select 1 from jsonb_array_elements(${taskTemplates.workflowDraft}->'nodes') step
            where not exists (select 1 from ${bots} where ${bots.id} = step->>'botId')
          )
        on conflict (template_id, draft_revision) do nothing
      `),
      db
        .select({ version: versions.version, revision: versions.draftRevision })
        .from(versions)
        .where(
          and(
            eq(versions.templateId, templateId),
            eq(versions.draftRevision, revision)
          )
        ),
    ])
    return rows[0]
      ? { success: true as const, release: rows[0] }
      : {
          success: false as const,
          error:
            "Could not publish this revision. Reopen the latest draft and check its bots.",
        }
  } catch {
    return {
      success: false as const,
      error: "Could not publish the template. Please try again.",
    }
  }
}
