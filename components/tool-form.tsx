"use client"

import {
  useCallback,
  useId,
  useRef,
  useState,
  useTransition,
  type Ref,
} from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { createTool, deleteTool, updateTool } from "@/actions/tool"
import type { ToolSummary } from "@/db/schema"
import {
  formatToolInput,
  toolEditorSchema,
  type ToolEditorFields,
  type ToolValues,
} from "@/db/tool-form-schema"
import {
  useSettingsFormGuard,
  type SettingsLeaveGuard,
} from "@/components/settings-form-guard"
import { getTool } from "@/queries/tools"
import {
  LibraryReadStatus,
  useLibraryRead,
} from "@/components/shared-library-panel"
import { SettingsDeleteAction } from "@/components/settings-detail-actions"
import {
  SettingsFormBody,
  SettingsFormFooter,
} from "@/components/settings-shell"
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldError,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"

const inputExample = `{
  "type": "object",
  "properties": {
    "query": { "type": "string" }
  },
  "additionalProperties": false
}`

function editorValues(
  tool:
    | (Pick<ToolValues, "name" | "description" | "displayName"> &
        Partial<Pick<ToolValues, "config" | "inputSchema">>)
    | null
): ToolEditorFields {
  const config = tool?.config
  return {
    displayName: tool?.displayName ?? "",
    name: tool?.name ?? "",
    description: tool?.description ?? "",
    method: config?.method ?? "GET",
    url: config?.url ?? "",
    authType: config?.auth.type ?? "none",
    envVar: config?.auth.type === "bearer_env" ? config.auth.envVar : "",
    schemaText: formatToolInput(tool?.inputSchema),
  }
}

export function ToolForm({
  tool,
  guard,
  onCancel,
}: {
  tool: ToolSummary | null
  guard: Ref<SettingsLeaveGuard>
  onCancel: () => void
}) {
  const id = useId()
  const form = useForm<ToolEditorFields, unknown, ToolValues>({
    resolver: zodResolver(toolEditorSchema),
    defaultValues: editorValues(tool),
  })
  const [toolId, setToolId] = useState(tool?.id)
  const { errors, isDirty, defaultValues } = form.formState
  const { reset } = form
  const accept = useCallback(
    (record: ToolValues) => reset(editorValues(record)),
    [reset]
  )
  const load = useCallback(() => getTool(tool?.id), [tool])
  const read = useLibraryRead(tool ? load : null, accept)
  const auth = useWatch({ control: form.control, name: "authType" })
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const saving = useRef(false)
  const { requestLeave, discardDialog } = useSettingsFormGuard(
    guard,
    isDirty,
    saving,
    "tool"
  )
  function save(values: ToolValues) {
    if (saving.current || !read.ready || (toolId && !isDirty)) return
    saving.current = true
    setError("")
    startTransition(async () => {
      try {
        const result = toolId
          ? await updateTool(toolId, values)
          : await createTool(values)
        if (result.success) {
          accept(values)
          setToolId(result.data.id)
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
      {!toolId && (
        <h2 className="border-b px-4 py-2 type-section-title">New tool</h2>
      )}
      <SettingsFormBody
        id={id}
        onSubmit={(event) => {
          if (!read.ready) event.preventDefault()
          else void form.handleSubmit(save)(event)
        }}
        className="flex [scrollbar-width:none] [scrollbar-gutter:auto] flex-col px-2 py-3 sm:px-4"
        noValidate
      >
        <fieldset disabled={pending} className="flex min-w-0 flex-1 flex-col">
          <FieldGroup className="flex-1 gap-2 [&_[data-slot=field]]:gap-1">
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <Field data-invalid={!!errors.displayName}>
                <FieldLabel htmlFor={id + "-display"}>
                  Display name{" "}
                  <span className="font-normal text-muted-foreground max-sm:sr-only">
                    (optional)
                  </span>
                </FieldLabel>
                <Input
                  id={id + "-display"}
                  readOnly={!read.ready}
                  aria-invalid={!!errors.displayName}
                  {...form.register("displayName")}
                />
                <FieldError errors={[errors.displayName]} />
              </Field>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor={id + "-name"}>Tool identifier</FieldLabel>
                <Input
                  id={id + "-name"}
                  readOnly={!read.ready}
                  placeholder="paper_search"
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-invalid={!!errors.name}
                  {...form.register("name")}
                />
                <FieldError errors={[errors.name]} />
              </Field>
            </div>
            <Field data-invalid={!!errors.description}>
              <FieldLabel htmlFor={id + "-description"}>Description</FieldLabel>
              <Controller
                control={form.control}
                name="description"
                render={({ field }) => (
                  <Input
                    {...field}
                    id={id + "-description"}
                    value={field.value.replace(/[\r\n]+/g, " ")}
                    readOnly={!read.ready}
                    placeholder="What does this tool do?"
                    aria-invalid={!!errors.description}
                  />
                )}
              />
              <FieldError errors={[errors.description]} />
            </Field>
            {!read.ready ? (
              <LibraryReadStatus
                label="Loading tool configuration…"
                {...read}
              />
            ) : (
              <>
                <div className="grid grid-cols-[7.75rem_minmax(0,1fr)] gap-x-1.5 gap-y-2 sm:gap-x-3">
                  <Field data-invalid={!!errors.method}>
                    <FieldLabel htmlFor={id + "-method"}>Method</FieldLabel>
                    <NativeSelect
                      id={id + "-method"}
                      aria-invalid={!!errors.method}
                      {...form.register("method")}
                    >
                      <option>GET</option>
                      <option>POST</option>
                    </NativeSelect>
                    <FieldError errors={[errors.method]} />
                  </Field>
                  <Field data-invalid={!!errors.url}>
                    <FieldLabel htmlFor={id + "-url"}>Endpoint URL</FieldLabel>
                    <Input
                      id={id + "-url"}
                      type="url"
                      placeholder="https://example.com/search"
                      spellCheck={false}
                      aria-invalid={!!errors.url}
                      {...form.register("url")}
                    />
                    <FieldError errors={[errors.url]} />
                  </Field>
                  <Field data-invalid={!!errors.authType}>
                    <FieldLabel htmlFor={id + "-auth"}>
                      Authentication
                    </FieldLabel>
                    <NativeSelect
                      id={id + "-auth"}
                      aria-invalid={!!errors.authType}
                      {...form.register("authType")}
                    >
                      <option value="none">None</option>
                      <option value="bearer_env">Bearer token</option>
                    </NativeSelect>
                    <FieldError errors={[errors.authType]} />
                  </Field>
                  {auth === "bearer_env" && (
                    <Field data-invalid={!!errors.envVar}>
                      <FieldLabel htmlFor={id + "-env"}>
                        Environment variable
                      </FieldLabel>
                      <Input
                        id={id + "-env"}
                        placeholder="TOOL_PAPER_API_TOKEN"
                        spellCheck={false}
                        aria-invalid={!!errors.envVar}
                        {...form.register("envVar")}
                      />
                      <FieldError errors={[errors.envVar]} />
                    </Field>
                  )}
                </div>
                <Field className="flex-1" data-invalid={!!errors.schemaText}>
                  <FieldLabel htmlFor={id + "-schema"}>
                    Input parameters
                  </FieldLabel>
                  <Textarea
                    id={id + "-schema"}
                    rows={1}
                    className="field-sizing-fixed min-h-12 flex-1 resize-none overflow-y-auto overscroll-contain font-mono"
                    spellCheck={false}
                    placeholder={`Press Enter to use this example\n${inputExample}`}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "Enter" ||
                        event.currentTarget.value !== "" ||
                        event.shiftKey ||
                        event.ctrlKey ||
                        event.altKey ||
                        event.metaKey ||
                        event.nativeEvent.isComposing ||
                        event.nativeEvent.keyCode === 229
                      )
                        return
                      event.preventDefault()
                      form.setValue("schemaText", inputExample, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                      const start = inputExample.indexOf('"query"') + 1
                      event.currentTarget.setSelectionRange(
                        start,
                        start + "query".length
                      )
                    }}
                    aria-invalid={!!errors.schemaText}
                    aria-describedby={
                      errors.schemaText ? id + "-schema-error" : undefined
                    }
                    {...form.register("schemaText")}
                  />
                  <FieldError
                    id={id + "-schema-error"}
                    errors={[errors.schemaText]}
                  />
                </Field>
              </>
            )}
          </FieldGroup>
        </fieldset>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </SettingsFormBody>
      <SettingsFormFooter
        formId={id}
        noun="tool"
        editing={!!toolId}
        dirty={isDirty}
        pending={pending}
        ready={read.ready}
        onCancel={() => requestLeave(onCancel)}
      >
        {toolId && (
          <SettingsDeleteAction
            noun="tool"
            title="Delete tool?"
            description={`Permanently delete ${defaultValues?.name} from the shared library?`}
            remove={() => deleteTool(toolId)}
            onDeleted={onCancel}
            disabled={pending || !read.ready}
          />
        )}
      </SettingsFormFooter>
      {discardDialog}
    </>
  )
}
