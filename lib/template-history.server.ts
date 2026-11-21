import "server-only"
import { sql } from "drizzle-orm"
import { taskTemplateVersions } from "@/db/schema"
import type { TemplateRelease } from "./workflow-version-tree"

// Templates published before version selection used the most recent release.
export const currentTemplateVersion = sql<
  number | null
>`coalesce(task_templates.current_version, (
  select max(v.version) from ${taskTemplateVersions} v where v.template_id = task_templates.id
))`

export const draftIsPublished = sql<boolean>`exists (
  select 1 from ${taskTemplateVersions} v where v.template_id = task_templates.id
    and v.version = ${currentTemplateVersion} and v.workflow = task_templates.workflow_draft
)`

export const versionStateFields = {
  currentVersion: currentTemplateVersion,
  draftPublished: draftIsPublished,
  releases: sql<TemplateRelease[]>`coalesce((
    select jsonb_agg(jsonb_build_object(
      'version', v.version,
      'parentVersion', coalesce(v.parent_version, nullif(v.version - 1, 0)),
      'publishedAt', v.published_at
    ) order by v.version desc)
    from ${taskTemplateVersions} v where v.template_id = task_templates.id
  ), '[]'::jsonb)`,
}
