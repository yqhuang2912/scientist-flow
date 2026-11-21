import { asc, desc, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { z } from "zod"
import { WorkflowEditor } from "@/components/workflow-editor"
import {
  bots,
  taskTemplates,
  taskTemplateVersions as versions,
} from "@/db/schema"
import { db } from "@/lib/db"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import { emptyWorkflowDraft } from "@/lib/workflow-draft"

export const metadata = { title: "Workflow draft · ScientistFlow" }

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  await assertInstallationRequest()
  const { templateId } = await params
  if (!z.nanoid().safeParse(templateId).success) notFound()
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
  if (!template) notFound()
  return (
    <WorkflowEditor
      key={template.id}
      templateId={template.id}
      name={template.name}
      revision={template.revision}
      draft={template.draft ?? emptyWorkflowDraft}
      bots={availableBots}
      latestRelease={latestRelease ?? null}
    />
  )
}
