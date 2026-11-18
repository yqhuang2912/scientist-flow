"use client"

import { useId, useRef, useState, useTransition, type Ref } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { createTool, updateTool } from "@/actions/tool"
import type { ToolDefinition } from "@/db/schema"
import {
  toolEditorSchema,
  type ToolEditorFields,
  type ToolValues,
} from "@/db/tool-form-schema"
import { emptyToolInput } from "@/lib/tool-definition"
import {
  useSettingsFormGuard,
  type SettingsLeaveGuard,
} from "@/components/settings-form-guard"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldError,
  FieldDescription,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"

export function ToolForm({
  tool,
  guard,
  onSaved,
  onCancel,
}: {
  tool: ToolDefinition | null
  guard: Ref<SettingsLeaveGuard>
  onSaved: (id: string) => void
  onCancel: () => void
}) {
  const id = useId()
  const form = useForm<ToolEditorFields, unknown, ToolValues>({
    resolver: zodResolver(toolEditorSchema),
    defaultValues: {
      displayName: tool?.displayName ?? "",
      name: tool?.name ?? "",
      description: tool?.description ?? "",
      method: tool?.config.method ?? "GET",
      url: tool?.config.url ?? "",
      authType: tool?.config.auth.type ?? "none",
      envVar:
        tool?.config.auth.type === "bearer_env" ? tool.config.auth.envVar : "",
      schemaText: JSON.stringify(tool?.inputSchema ?? emptyToolInput, null, 2),
    },
  })
  const { errors, isDirty } = form.formState
  const auth = useWatch({ control: form.control, name: "authType" })
  const method = useWatch({ control: form.control, name: "method" })
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
    if (saving.current) return
    saving.current = true
    setError("")
    startTransition(async () => {
      try {
        const result = tool
          ? await updateTool(tool.id, values)
          : await createTool(values)
        if (result.success) onSaved(result.data.id)
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
      <div className="pr-6">
        <h2 className="type-section-title">
          {tool ? "Edit tool" : "New tool"}
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          HTTP API definition
        </p>
      </div>
      <form
        id={id}
        onSubmit={(event) => form.handleSubmit(save)(event)}
        noValidate
      >
        <fieldset disabled={pending}>
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field data-invalid={!!errors.displayName}>
                <FieldLabel htmlFor={id + "-display"}>
                  Display name{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FieldLabel>
                <Input
                  id={id + "-display"}
                  aria-invalid={!!errors.displayName}
                  {...form.register("displayName")}
                />
                <FieldError errors={[errors.displayName]} />
              </Field>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor={id + "-name"}>Tool identifier</FieldLabel>
                <Input
                  id={id + "-name"}
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
              <Textarea
                id={id + "-description"}
                rows={2}
                placeholder="What does this tool do, and when should it be used?"
                aria-invalid={!!errors.description}
                {...form.register("description")}
              />
              <FieldError errors={[errors.description]} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
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
            </div>
            <Field data-invalid={!!errors.authType}>
              <FieldLabel htmlFor={id + "-auth"}>Authentication</FieldLabel>
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
                <FieldDescription>
                  The runtime supplies the secret. Enter only its environment
                  variable name.
                </FieldDescription>
                <FieldError errors={[errors.envVar]} />
              </Field>
            )}
            <Field data-invalid={!!errors.schemaText}>
              <FieldLabel htmlFor={id + "-schema"}>Input parameters</FieldLabel>
              <FieldDescription>
                {method === "GET"
                  ? "Declare scalar query parameters for GET."
                  : "Describe the JSON body for POST, including nested objects and arrays."}{" "}
                Use description to explain each parameter.
              </FieldDescription>
              <Controller
                name="schemaText"
                control={form.control}
                render={({ field }) => (
                  <Textarea
                    id={id + "-schema"}
                    rows={7}
                    className="max-h-80 min-h-28 font-mono text-xs"
                    spellCheck={false}
                    aria-invalid={!!errors.schemaText}
                    {...field}
                  />
                )}
              />
              <FieldError errors={[errors.schemaText]} />
              <details className="text-xs text-muted-foreground">
                <summary className="w-fit cursor-pointer">
                  Example schema
                </summary>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-2">
                  {JSON.stringify(
                    {
                      type: "object",
                      properties: {
                        query: { type: "string", description: "Search terms" },
                      },
                      required: ["query"],
                      additionalProperties: false,
                    },
                    null,
                    2
                  )}
                </pre>
              </details>
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
        <Button size="sm" type="submit" form={id} disabled={pending}>
          {pending && <Spinner />}
          {tool ? "Save changes" : "Create tool"}
        </Button>
      </div>
      {discardDialog}
    </>
  )
}
