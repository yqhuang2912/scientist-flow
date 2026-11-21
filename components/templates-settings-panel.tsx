"use client"

import { useId, useRef, useState, useTransition, type Ref } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { WorkflowIcon } from "lucide-react"
import type { z } from "zod"
import { saveTaskTemplate } from "@/actions/task-template"
import { taskTemplateFormSchema, type TaskTemplateSummary } from "@/db/schema"
import { getTaskTemplates } from "@/queries/task-templates"
import {
  useSettingsFormGuard,
  type SettingsLeaveGuard,
} from "@/components/settings-form-guard"
import {
  SettingsFormBody,
  SettingsFormError,
  SettingsFormFooter,
} from "@/components/settings-shell"
import { SharedLibraryPanel } from "@/components/shared-library-panel"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type TemplateChange = (
  id: string,
  updated: TaskTemplateSummary | null
) => void

export function TemplatesSettingsPanel({
  guard,
  onOpenWorkflow,
}: {
  guard: Ref<SettingsLeaveGuard>
  onOpenWorkflow: (template: TaskTemplateSummary) => void
}) {
  return (
    <SharedLibraryPanel
      noun="template"
      title="Templates"
      description="Manage reusable workflows for research tasks."
      icon={<WorkflowIcon />}
      getList={getTaskTemplates}
      onOpen={onOpenWorkflow}
      renderForm={(template, close) => (
        <TemplateForm template={template} guard={guard} close={close} />
      )}
    />
  )
}

export function TemplateForm({
  template,
  guard,
  close,
  onRenamed,
}: {
  template: TaskTemplateSummary | null
  guard: Ref<SettingsLeaveGuard>
  close: () => void
  onRenamed?: (updated: TaskTemplateSummary) => void
}) {
  const formId = useId()
  const form = useForm<
    z.input<typeof taskTemplateFormSchema>,
    unknown,
    z.output<typeof taskTemplateFormSchema>
  >({
    resolver: zodResolver(taskTemplateFormSchema),
    defaultValues: {
      name: template?.name ?? "",
    },
  })
  const { errors, isDirty } = form.formState
  const saving = useRef(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")
  const { requestLeave, discardDialog } = useSettingsFormGuard(
    guard,
    isDirty,
    saving,
    "template"
  )

  function save(values: z.output<typeof taskTemplateFormSchema>) {
    if (saving.current || (template && !isDirty)) return
    saving.current = true
    setError("")
    startTransition(async () => {
      try {
        const result = await saveTaskTemplate(template?.id ?? null, values)
        if (result.success) {
          onRenamed?.({ id: result.id, name: values.name })
          close()
        } else setError(result.error)
      } catch {
        setError("Could not reach the server. Please try again.")
      } finally {
        saving.current = false
      }
    })
  }

  return (
    <>
      {!template && (
        <h2 className="border-b px-4 py-3 type-section-title">New template</h2>
      )}
      <SettingsFormBody
        id={formId}
        onSubmit={(event) => form.handleSubmit(save)(event)}
      >
        <fieldset disabled={pending}>
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor={formId + "-name"}>Name</FieldLabel>
              <Input
                id={formId + "-name"}
                aria-invalid={!!errors.name}
                aria-describedby={
                  errors.name ? formId + "-name-error" : undefined
                }
                {...form.register("name")}
              />
              <FieldError id={formId + "-name-error"} errors={[errors.name]} />
            </Field>
          </FieldGroup>
        </fieldset>
        <SettingsFormError error={error} className="mt-3" />
      </SettingsFormBody>
      <SettingsFormFooter
        formId={formId}
        noun="template"
        editing={!!template}
        submitLabel={template ? "Rename" : undefined}
        dirty={isDirty}
        pending={pending}
        onCancel={() => requestLeave(close)}
      />
      {discardDialog}
    </>
  )
}
