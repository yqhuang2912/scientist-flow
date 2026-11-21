"use client"

import { useId, useRef, useState, useTransition, type Ref } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { ExternalLinkIcon, WorkflowIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import type { z } from "zod"
import { deleteTaskTemplate, saveTaskTemplate } from "@/actions/task-template"
import { taskTemplateFormSchema, type TaskTemplateSummary } from "@/db/schema"
import { getTaskTemplates } from "@/queries/task-templates"
import { SettingsDeleteAction } from "@/components/settings-detail-actions"
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
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export function TemplatesSettingsPanel({
  guard,
}: {
  guard: Ref<SettingsLeaveGuard>
}) {
  return (
    <SharedLibraryPanel
      noun="template"
      title="Templates"
      description="Manage reusable workflows for research tasks."
      icon={<WorkflowIcon />}
      getList={getTaskTemplates}
      renderForm={(template, close) => (
        <TemplateForm template={template} guard={guard} close={close} />
      )}
    />
  )
}

function TemplateForm({
  template,
  guard,
  close,
}: {
  template: TaskTemplateSummary | null
  guard: Ref<SettingsLeaveGuard>
  close: () => void
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
      description: template?.description ?? "",
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
        if (result.success) close()
        else setError(result.error)
      } catch {
        setError("Could not reach the server. Please try again.")
      } finally {
        saving.current = false
      }
    })
  }

  return (
    <>
      <h2 className="border-b px-4 py-3 type-section-title">
        {template ? "Edit template" : "New template"}
      </h2>
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
            <Field data-invalid={!!errors.description}>
              <FieldLabel htmlFor={formId + "-description"}>
                Description (optional)
              </FieldLabel>
              <Textarea
                id={formId + "-description"}
                rows={2}
                aria-invalid={!!errors.description}
                {...form.register("description")}
              />
              <FieldError errors={[errors.description]} />
            </Field>
            {template && (
              <FieldSet>
                <FieldLegend variant="label">Workflow</FieldLegend>
                <a
                  href={`/templates/${template.id}/workflow`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "w-fit",
                  })}
                >
                  Edit workflow <ExternalLinkIcon data-icon="inline-end" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </FieldSet>
            )}
          </FieldGroup>
        </fieldset>
        <SettingsFormError error={error} className="mt-3" />
      </SettingsFormBody>
      <SettingsFormFooter
        formId={formId}
        noun="template"
        editing={!!template}
        dirty={isDirty}
        pending={pending}
        onCancel={() => requestLeave(close)}
      >
        {template && (
          <SettingsDeleteAction
            noun="template"
            title="Delete template?"
            description={`Permanently delete “${template.name}”?`}
            remove={() => deleteTaskTemplate(template.id)}
            onDeleted={close}
            disabled={pending}
          />
        )}
      </SettingsFormFooter>
      {discardDialog}
    </>
  )
}
