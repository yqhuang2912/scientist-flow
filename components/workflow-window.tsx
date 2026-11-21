"use client"

import { useCallback, useState, type Ref } from "react"
import { WorkflowIcon } from "lucide-react"
import { getWorkflowEditorData } from "@/queries/task-templates"
import type { TaskTemplateSummary } from "@/db/schema"
import type { SettingsLeaveGuard } from "./settings-form-guard"
import { FloatingWindow } from "./floating-window"
import { LibraryReadStatus, useLibraryRead } from "./shared-library-panel"
import { WorkflowEditor } from "./workflow-editor"
import type { TemplateChange } from "./templates-settings-panel"

export function WorkflowWindow({
  template,
  activation,
  guard,
  onClose,
  onTemplateChange,
}: {
  template: TaskTemplateSummary
  activation: number
  guard: Ref<SettingsLeaveGuard>
  onClose: () => void
  onTemplateChange: TemplateChange
}) {
  const [data, setData] =
    useState<Awaited<ReturnType<typeof getWorkflowEditorData>>>(null)
  const [dirty, setDirty] = useState(false)
  const load = useCallback(async () => {
    const result = await getWorkflowEditorData(template.id)
    return result
      ? { success: true as const, data: result }
      : {
          success: false as const,
          error: "This template is no longer available.",
        }
  }, [template.id])
  const read = useLibraryRead(load, setData)
  const name = template.name
  return (
    <FloatingWindow
      kind="workflow"
      name={name}
      label={`Workflow · ${name}`}
      dirty={dirty}
      activation={activation}
      onClose={onClose}
      icon={<WorkflowIcon className="size-4 shrink-0" />}
    >
      {data ? (
        <WorkflowEditor
          {...data}
          name={name}
          guard={guard}
          onDirtyChange={setDirty}
          onTemplateChange={onTemplateChange}
        />
      ) : (
        <div className="p-4">
          <LibraryReadStatus label="Loading workflow…" {...read} />
        </div>
      )}
    </FloatingWindow>
  )
}
