"use client"
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type Ref,
} from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CableIcon, RefreshCwIcon } from "lucide-react"
import { connectionFormSchema } from "@/db/schema"
import { connectionStatus, type ConnectionSummary } from "@/lib/model-catalog"
import {
  getModelConnections,
  saveModelConnection,
  updateConnectionCatalog,
  removeModelConnection,
} from "@/actions/model-connections"
import { SettingsList, SettingsListHeader } from "./settings-list"
import {
  SettingsPane,
  SettingsEditorPane,
  SettingsFormBody,
  SettingsFormFooter,
  SettingsFormError,
} from "./settings-shell"
import {
  useSettingsFormGuard,
  type SettingsLeaveGuard,
} from "./settings-form-guard"
import { SettingsDeleteAction } from "./settings-detail-actions"
import { Field, FieldGroup, FieldLabel, FieldError } from "./ui/field"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { NativeSelect } from "./ui/native-select"

export function ModelConnectionsPanel({
  guard,
}: {
  guard: Ref<SettingsLeaveGuard>
}) {
  const [rows, setRows] = useState<ConnectionSummary[] | null>(null)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [editor, setEditor] = useState<string | null>(null)
  const [version, reload] = useState(0)
  useEffect(() => {
    let current = true
    getModelConnections()
      .then((r) => {
        if (!current) return
        if (r.success) {
          setRows(r.data)
          setError("")
        } else setError(r.error)
      })
      .catch(() => {
        if (current) setError("Could not load connections.")
      })
    return () => {
      current = false
    }
  }, [version])
  const row = rows?.find((r) => r.id === editor)
  if (editor === "new" || row)
    return (
      <SettingsEditorPane label="Model connection">
        <ConnectionForm
          key={editor}
          row={row}
          guard={guard}
          close={() => setEditor(null)}
          reload={() => reload((n) => n + 1)}
        />
      </SettingsEditorPane>
    )
  const items = (rows ?? []).filter((r) =>
    r.nickname.toLowerCase().includes(search.trim().toLowerCase())
  )
  return (
    <SettingsPane className="gap-3" aria-label="Model connections">
      <SettingsListHeader
        title="Model connections"
        noun="connection"
        description="Manage the model accounts available to your bots."
        search={search}
        onSearch={setSearch}
        onCreate={() => setEditor("new")}
      />
      {error && (
        <p role="alert">
          {error}{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => reload((n) => n + 1)}
          >
            Retry
          </Button>
        </p>
      )}
      {rows ? (
        <SettingsList
          icon={<CableIcon />}
          emptyLabel={
            search ? "No matching connections" : "No model connections yet"
          }
          items={items.map((r) => ({
            id: r.id,
            name: r.nickname,
            description:
              "OpenRouter · " +
              (r.state === "ready"
                ? r.catalog.length + " models"
                : connectionStatus[r.state]),
            icon: <CableIcon />,
            onSelect: () => setEditor(r.id),
          }))}
        />
      ) : (
        !error && <p>Loading connections…</p>
      )}
    </SettingsPane>
  )
}

function ConnectionForm({
  row,
  close,
  reload,
  guard,
}: {
  row?: ConnectionSummary
  close: () => void
  reload: () => void
  guard: Ref<SettingsLeaveGuard>
}) {
  const formId = useId()
  const form = useForm({
    resolver: zodResolver(connectionFormSchema),
    defaultValues: {
      provider: "openrouter" as const,
      nickname: row?.nickname ?? "",
      apiKey: "",
    },
  })
  const [pending, start] = useTransition()
  const busy = useRef(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const { requestLeave, discardDialog } = useSettingsFormGuard(
    guard,
    form.formState.isDirty,
    busy,
    "connection"
  )
  const target = row && { id: row.id, revision: row.revision }
  function run(
    operation: () => ReturnType<typeof saveModelConnection>,
    saved: boolean
  ) {
    if (busy.current) return
    busy.current = true
    setError("")
    setNotice("")
    start(async () => {
      try {
        const r = await operation()
        reload()
        if (!r.success) {
          setError(r.error)
          return
        }
        if (saved) close()
        else setNotice("Catalog refreshed.")
      } catch {
        setError("Could not update the connection.")
      } finally {
        busy.current = false
      }
    })
  }
  return (
    <>
      <SettingsFormBody
        id={formId}
        className="space-y-4"
        onSubmit={(event) =>
          void form.handleSubmit((values) =>
            run(() => saveModelConnection(values, target), true)
          )(event)
        }
      >
        <fieldset disabled={pending}>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="connection-provider">Provider</FieldLabel>
              <NativeSelect
                id="connection-provider"
                {...form.register("provider")}
              >
                <option value="openrouter">OpenRouter</option>
              </NativeSelect>
            </Field>
            <Field data-invalid={!!form.formState.errors.nickname}>
              <FieldLabel htmlFor="connection-name">Connection name</FieldLabel>
              <Input
                id="connection-name"
                aria-invalid={!!form.formState.errors.nickname}
                {...form.register("nickname")}
              />
              <FieldError errors={[form.formState.errors.nickname]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.apiKey}>
              <FieldLabel htmlFor="connection-key">
                {row ? "Replacement API key" : "API key"}
              </FieldLabel>
              <Input
                id="connection-key"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                aria-invalid={!!form.formState.errors.apiKey}
                {...form.register("apiKey")}
              />
              <FieldError errors={[form.formState.errors.apiKey]} />
            </Field>
            {row && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {connectionStatus[row.state]}
                  {row.state === "ready" &&
                    " · " + row.catalog.length + " models"}
                </span>
                {row.state !== "disconnected" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      run(() => updateConnectionCatalog(target), false)
                    }
                  >
                    <RefreshCwIcon />
                    Refresh catalog
                  </Button>
                )}
              </div>
            )}
          </FieldGroup>
        </fieldset>
        <SettingsFormError error={error} />
        {notice && (
          <p className="text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        )}
      </SettingsFormBody>
      <SettingsFormFooter
        formId={formId}
        noun="connection"
        editing={!!row}
        dirty={form.formState.isDirty}
        pending={pending}
        onCancel={() => requestLeave(close)}
      >
        {row && row.state !== "disconnected" && (
          <SettingsDeleteAction
            noun="connection"
            actionLabel="Disconnect"
            title={"Disconnect " + row.nickname + "?"}
            description="Bots using this connection will need a working connection before they can reply."
            disabled={pending}
            remove={() => removeModelConnection(target)}
            onDeleted={() => {
              reload()
              close()
            }}
          />
        )}
      </SettingsFormFooter>
      {discardDialog}
    </>
  )
}
