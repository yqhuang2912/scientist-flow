"use client"
import {
  useEffect,
  useCallback,
  useId,
  useRef,
  useState,
  useTransition,
  type Ref,
} from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CableIcon, PlusIcon, RefreshCwIcon } from "lucide-react"
import { connectionFormSchema } from "@/db/schema"
import {
  connectionLabel,
  connectionStatus,
  openRouterBaseUrl,
  type ConnectionSummary,
} from "@/lib/model-catalog"
import {
  getModelConnections,
  saveModelConnection,
  updateConnectionCatalog,
  removeModelConnection,
} from "@/actions/model-connections"
import { ChatGPTAccounts, ChatProfileEditor } from "./chatgpt-accounts"
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

export function ModelConnectionsPanel({
  guard,
}: {
  guard: Ref<SettingsLeaveGuard>
}) {
  const [rows, setRows] = useState<ConnectionSummary[] | null>(null)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [editor, setEditor] = useState<string | null>(null)
  const [profile, setProfile] = useState<{
    row?: ConnectionSummary
    rename?: boolean
  } | null>(null)
  const closeProfile = useCallback(() => setProfile(null), [])
  const [version, reload] = useState(0)
  const reloadRows = useCallback(() => reload((n) => n + 1), [])
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
  if (profile)
    return (
      <ChatProfileEditor
        edit={profile}
        guard={guard}
        close={closeProfile}
        reload={reloadRows}
      />
    )
  const row = rows?.find((r) => r.id === editor)
  if (editor === "new" || row)
    return (
      <SettingsEditorPane label="Custom gateway">
        <ConnectionForm
          key={editor}
          row={row}
          guard={guard}
          close={() => setEditor(null)}
          reload={() => reload((n) => n + 1)}
        />
      </SettingsEditorPane>
    )
  const items = (rows ?? [])
    .filter((r) => r.provider !== "chatgpt")
    .filter((r) =>
      [r.baseUrl, r.nickname].some((s) =>
        s?.toLowerCase().includes(search.trim().toLowerCase())
      )
    )
  return (
    <SettingsPane className="gap-3" aria-label="Models">
      <SettingsListHeader
        title="Models"
        description="Manage ChatGPT accounts and gateways for your bots."
        search={search}
        onSearch={setSearch}
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
      {rows && (
        <ChatGPTAccounts
          rows={rows.filter((r) => r.provider === "chatgpt")}
          search={search}
          onEdit={setProfile}
          reload={reloadRows}
        />
      )}
      <section aria-label="Custom gateways" className="grid gap-1">
        <div className="flex items-center justify-between">
          <h3 className="type-control font-medium">Custom gateways</h3>
          <Button size="sm" variant="ghost" onClick={() => setEditor("new")}>
            <PlusIcon />
            Add gateway
          </Button>
        </div>
        {rows ? (
          <SettingsList
            icon={<CableIcon />}
            emptyLabel={search ? "No matching gateways" : "No gateways yet"}
            items={items.map((r) => ({
              id: r.id,
              name: connectionLabel(r, rows),
              description:
                (r.baseUrl === openRouterBaseUrl ? "OpenRouter · " : "") +
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
      </section>
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
      baseUrl: row?.baseUrl ?? "",
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
            <Field data-invalid={!!form.formState.errors.baseUrl}>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="gateway-url">Base URL</FieldLabel>
                {!row && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() =>
                      form.setValue("baseUrl", openRouterBaseUrl, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  >
                    Use OpenRouter
                  </Button>
                )}
              </div>
              <Input
                id="gateway-url"
                placeholder="https://gateway.example.com/v1"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                aria-invalid={!!form.formState.errors.baseUrl}
                {...form.register("baseUrl")}
              />
              <FieldError errors={[form.formState.errors.baseUrl]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.apiKey}>
              <FieldLabel htmlFor="connection-key">API key</FieldLabel>
              <Input
                id="connection-key"
                type="password"
                placeholder={
                  row && row.state !== "disconnected"
                    ? "Enter a replacement key"
                    : "If required by the gateway"
                }
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
        noun="gateway"
        editing={!!row}
        dirty={form.formState.isDirty}
        pending={pending}
        onCancel={() => requestLeave(close)}
      >
        {row && row.state !== "disconnected" && (
          <SettingsDeleteAction
            noun="connection"
            actionLabel="Disconnect"
            title={"Disconnect " + (row.baseUrl ?? row.nickname) + "?"}
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
