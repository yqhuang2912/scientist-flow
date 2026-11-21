import { notFound } from "next/navigation"
import { WorkflowEditor } from "@/components/workflow-editor"
import { getWorkflowEditorData } from "@/queries/task-templates"

export const metadata = { title: "Workflow draft · ScientistFlow" }

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const { templateId } = await params
  const data = await getWorkflowEditorData(templateId)
  if (!data) notFound()
  return <WorkflowEditor key={templateId} {...data} />
}
