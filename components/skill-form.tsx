"use client"

import {
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type Ref,
} from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { createSkill, updateSkill } from "@/actions/skill"
import { DocumentEditor } from "@/components/document-editor"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  useSettingsFormGuard,
  type SettingsLeaveGuard,
} from "@/components/settings-form-guard"
import {
  skillFormSchema,
  type Skill,
  type SkillInput,
  type SkillValues,
} from "@/db/schema"

export function SkillForm({
  skill,
  guard,
  onCancel,
  onSaved,
}: {
  skill: Skill | null
  guard: Ref<SettingsLeaveGuard>
  onCancel: () => void
  onSaved: (id: string) => void
}) {
  const formId = useId()
  const form = useForm<SkillInput, unknown, SkillValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: {
      displayName: skill?.displayName ?? "",
      name: skill?.name ?? "",
      description: skill?.description ?? "",
      instructions: skill?.instructions ?? "",
    },
  })
  const { errors, isDirty } = form.formState
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const saving = useRef(false)
  const { requestLeave, discardDialog } = useSettingsFormGuard(
    guard,
    isDirty,
    saving,
    "skill"
  )

  function submit(event?: FormEvent<HTMLFormElement>) {
    return form.handleSubmit(
      (values) => {
        if (saving.current) return
        saving.current = true
        setError("")
        startTransition(async () => {
          try {
            const result = skill
              ? await updateSkill(skill.id, values)
              : await createSkill(values)
            if (result.success) onSaved(result.data.id)
            else setError(result.error)
          } catch {
            setError("Could not reach the server. Please try again.")
          } finally {
            saving.current = false
          }
        })
      },
      (invalid) => {
        if (Object.keys(invalid)[0] === "instructions")
          document.getElementById(formId + "-body")?.focus()
      }
    )(event)
  }

  return (
    <>
      <h2 className="pr-7 type-section-title">
        {skill ? "Edit skill" : "New skill"}
      </h2>
      <form id={formId} onSubmit={submit}>
        <fieldset disabled={pending}>
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field data-invalid={!!errors.displayName}>
                <FieldLabel htmlFor={formId + "-display"}>
                  Display name{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FieldLabel>
                <Input
                  id={formId + "-display"}
                  aria-invalid={!!errors.displayName}
                  {...form.register("displayName")}
                />
                <FieldError errors={[errors.displayName]} />
              </Field>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor={formId + "-name"}>
                  Skill identifier
                </FieldLabel>
                <Input
                  id={formId + "-name"}
                  placeholder="literature-review"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!errors.name}
                  {...form.register("name")}
                />
                <FieldError errors={[errors.name]} />
              </Field>
            </div>
            <Field data-invalid={!!errors.description}>
              <FieldLabel htmlFor={formId + "-description"}>
                Description
              </FieldLabel>
              <Textarea
                id={formId + "-description"}
                rows={2}
                aria-invalid={!!errors.description}
                aria-describedby={formId + "-help"}
                {...form.register("description")}
              />
              <FieldDescription id={formId + "-help"}>
                Agents use this description to decide when to use the skill.
              </FieldDescription>
              <FieldError errors={[errors.description]} />
            </Field>
            <Field data-invalid={!!errors.instructions}>
              <FieldLabel
                htmlFor={formId + "-body"}
                onClick={() =>
                  document.getElementById(formId + "-body")?.focus()
                }
              >
                Markdown instructions
              </FieldLabel>
              <div className="h-44 min-w-0 overflow-hidden rounded-xl border border-input [--editor-content-padding:0.5rem_0] [--editor-line-inset:0.625rem]">
                <Controller
                  control={form.control}
                  name="instructions"
                  render={({ field }) => (
                    <DocumentEditor
                      inputId={formId + "-body"}
                      invalid={!!errors.instructions}
                      label="Markdown instructions"
                      language="markdown"
                      readOnly={pending}
                      value={field.value}
                      onChange={field.onChange}
                      onSave={() => void submit()}
                    />
                  )}
                />
              </div>
              <FieldError errors={[errors.instructions]} />
            </Field>
          </FieldGroup>
        </fieldset>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => requestLeave(onCancel)}
        >
          Cancel
        </Button>
        <Button size="sm" type="submit" form={formId} disabled={pending}>
          {pending && <Spinner />}
          {skill ? "Save changes" : "Create skill"}
        </Button>
      </div>
      {discardDialog}
    </>
  )
}
