"use client"

import {
  useCallback,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type Ref,
} from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { createSkill, deleteSkill, updateSkill } from "@/actions/skill"
import { getSkill } from "@/queries/skills"
import { DocumentEditor } from "@/components/document-editor"
import { SettingsDeleteAction } from "@/components/settings-detail-actions"
import {
  LibraryReadStatus,
  useLibraryRead,
} from "@/components/shared-library-panel"
import {
  SettingsFormBody,
  SettingsFormFooter,
} from "@/components/settings-shell"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  useSettingsFormGuard,
  type SettingsLeaveGuard,
} from "@/components/settings-form-guard"
import {
  skillFormSchema,
  type Skill,
  type SkillSummary,
  type SkillInput,
  type SkillValues,
} from "@/db/schema"

export function SkillForm({
  skill,
  guard,
  onCancel,
}: {
  skill: SkillSummary | null
  guard: Ref<SettingsLeaveGuard>
  onCancel: () => void
}) {
  const formId = useId()
  const [skillId, setSkillId] = useState(skill?.id)
  const form = useForm<SkillInput, unknown, SkillValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: {
      displayName: skill?.displayName ?? "",
      name: skill?.name ?? "",
      description: skill?.description ?? "",
      instructions: "",
    },
  })
  const { errors, isDirty, defaultValues } = form.formState
  const { reset } = form
  const load = useCallback(() => getSkill(skill?.id), [skill])
  const accept = useCallback(
    ({ name, displayName, description, instructions }: Skill) => {
      reset({ name, displayName: displayName ?? "", description, instructions })
    },
    [reset]
  )
  const read = useLibraryRead(skill ? load : null, accept)
  const { ready } = read
  const unchanged = !!skillId && !isDirty
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
    if (!ready || unchanged || saving.current) {
      event?.preventDefault()
      return
    }
    return form.handleSubmit(
      (values) => {
        if (saving.current) return
        saving.current = true
        setError("")
        startTransition(async () => {
          try {
            const result = skillId
              ? await updateSkill(skillId, values)
              : await createSkill(values)
            if (!result.success) setError(result.error)
            else {
              form.reset({ ...values, displayName: values.displayName ?? "" })
              setSkillId(result.data.id)
            }
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
      {!skillId && (
        <h2 className="border-b px-4 py-3 type-section-title">New skill</h2>
      )}
      <SettingsFormBody id={formId} onSubmit={submit} className="flex flex-col">
        <fieldset disabled={pending} className="flex min-w-0 flex-1 flex-col">
          <FieldGroup className="flex-1">
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
                  readOnly={!ready}
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
                  readOnly={!ready}
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
                readOnly={!ready}
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
            <Field data-invalid={!!errors.instructions} className="flex-1">
              <FieldLabel
                htmlFor={formId + "-body"}
                onClick={() =>
                  document.getElementById(formId + "-body")?.focus()
                }
              >
                Markdown instructions
              </FieldLabel>
              <div className="relative min-h-32 min-w-0 flex-1 overflow-hidden rounded-xl border border-input bg-background [--editor-content-padding:0.5rem_0] [--editor-line-inset:0.625rem]">
                <div className="absolute inset-0">
                  {!ready ? (
                    <div className="p-3">
                      <LibraryReadStatus
                        label="Loading instructions…"
                        {...read}
                      />
                    </div>
                  ) : (
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
                  )}
                </div>
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
      </SettingsFormBody>
      <SettingsFormFooter
        formId={formId}
        noun="skill"
        editing={!!skillId}
        dirty={isDirty}
        pending={pending}
        ready={ready}
        onCancel={() => requestLeave(onCancel)}
      >
        {skillId && (
          <SettingsDeleteAction
            noun="skill"
            title="Delete skill?"
            description={`Permanently delete ${defaultValues?.name} from the shared library?`}
            remove={() => deleteSkill(skillId)}
            onDeleted={onCancel}
            disabled={pending || !ready}
          />
        )}
      </SettingsFormFooter>
      {discardDialog}
    </>
  )
}
