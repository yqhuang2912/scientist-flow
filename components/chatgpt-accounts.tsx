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
import { EllipsisIcon, PlusIcon, UserRoundIcon } from "lucide-react"
import { profileNameSchema } from "@/db/schema"
import { connectionStatus, type ConnectionSummary } from "@/lib/model-catalog"
import { cn } from "@/lib/utils"
import {
  beginProfileLogin,
  profileLoginProgress,
  renameProfile,
  removeModelConnection,
  updateConnectionCatalog,
} from "@/actions/model-connections"
import { Button } from "./ui/button"
import { compactItemStyles } from "./ui/compact-styles"
import { Input } from "./ui/input"
import { Field, FieldGroup, FieldLabel, FieldError } from "./ui/field"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogCancel,
} from "./ui/alert-dialog"
import {
  SettingsEditorPane,
  SettingsFormBody,
  SettingsFormError,
} from "./settings-shell"
import { DialogFooter } from "./ui/dialog"
import { SettingsListEmpty } from "./settings-list"
import {
  useSettingsFormGuard,
  type SettingsLeaveGuard,
} from "./settings-form-guard"

type Edit = { row?: ConnectionSummary; rename?: boolean }
export function ChatGPTAccounts({
  rows,
  query,
  onEdit,
  reload,
}: {
  rows: ConnectionSummary[] | undefined
  query: string
  onEdit: (edit: Edit) => void
  reload: () => void
}) {
  const [disconnect, setDisconnect] = useState<ConnectionSummary | null>(null)
  const [error, setError] = useState(""),
    [pending, start] = useTransition()
  const matches = rows?.filter((r) => r.nickname.toLowerCase().includes(query))
  function update(row: ConnectionSummary, remove: boolean) {
    setError("")
    start(async () => {
      try {
        const target = { id: row.id, revision: row.revision }
        const result = await (remove
          ? removeModelConnection(target)
          : updateConnectionCatalog(target))
        if (!result.success) setError(result.error)
      } catch {
        setError("Could not update this account.")
      } finally {
        setDisconnect(null)
        reload()
      }
    })
  }
  return (
    <section className="grid gap-1" aria-label="ChatGPT accounts">
      <div className="flex items-center justify-between">
        <h3 className="type-control font-medium">ChatGPT</h3>
        <Button size="sm" variant="ghost" onClick={() => onEdit({})}>
          <PlusIcon />
          Add account
        </Button>
      </div>
      {matches?.length === 0 && (
        <SettingsListEmpty
          icon={<UserRoundIcon />}
          label={
            rows?.length
              ? "No matching ChatGPT accounts"
              : "No ChatGPT accounts added yet"
          }
        />
      )}
      {matches?.map((r) => (
        <div key={r.id} className="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            aria-label={"Edit nickname for " + r.nickname}
            disabled={pending}
            onClick={() => onEdit({ row: r, rename: true })}
            className={cn(
              compactItemStyles,
              "h-auto min-w-0 flex-1 justify-start py-1.5 text-left"
            )}
          >
            <span
              aria-hidden
              className="flex w-7 shrink-0 items-center justify-center"
            >
              <UserRoundIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {r.nickname}{" "}
                <span className="text-xs text-muted-foreground">
                  · {r.id.slice(-6)}
                </span>
              </span>
              <span
                className="block truncate text-xs font-normal text-muted-foreground"
                title={r.usedBy?.join(", ")}
              >
                {r.state === "ready" ? "Ready" : connectionStatus[r.state]}
                {r.usedBy?.length ? " · " + r.usedBy.join(", ") : ""}
              </span>
              {!!r.needsModelChange?.length && (
                <span className="block whitespace-normal break-words text-xs font-normal text-destructive">
                  Choose a new model or effort for {r.needsModelChange.join(", ")}.
                </span>
              )}
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={"Actions for " + r.nickname}
                  disabled={pending}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onEdit({ row: r, rename: true })}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit({ row: r })}>
                {r.state === "identity-only"
                  ? "Enable plan usage"
                  : "Reauthorize"}
              </DropdownMenuItem>
              {r.state !== "disconnected" && (
                <>
                  {r.state !== "identity-only" && (
                    <DropdownMenuItem onClick={() => update(r, false)}>
                      Refresh models
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDisconnect(r)}
                  >
                    Disconnect
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <AlertDialog
        open={!!disconnect}
        onOpenChange={(v) => {
          if (!v && !pending) setDisconnect(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {disconnect?.nickname}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {disconnect?.usedBy?.length
                ? "Affected bots: " + disconnect.usedBy.join(", ") + ". "
                : ""}
              Reconnect or choose another account to resume requests.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => disconnect && update(disconnect, true)}
            >
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
export function ChatProfileEditor({
  edit,
  guard,
  close,
  reload,
}: {
  edit: Edit
  guard: Ref<SettingsLeaveGuard>
  close: () => void
  reload: () => void
}) {
  const id = useId(),
    [pending, start] = useTransition(),
    [error, setError] = useState("")
  const [login, setLogin] = useState<{
    attempt: string
    startUrl: string
    opened: boolean
  } | null>(null)
  const row = edit.row,
    form = useForm({
      resolver: zodResolver(profileNameSchema),
      defaultValues: { nickname: row?.nickname ?? "" },
    })
  const busy = useRef(false)
  const { requestLeave, discardDialog } = useSettingsFormGuard(
    guard,
    form.formState.isDirty && !login,
    busy,
    "account"
  )
  useEffect(() => {
    if (!login) return
    let active = true,
      timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const s = await profileLoginProgress(login.attempt)
        if (!active) return
        if (s.success && s.data.state === "pending") {
          timer = setTimeout(poll, 1200)
          return
        }
        setLogin(null)
        if (s.success && s.data.state === "done") {
          reload()
          close()
        } else setError(s.success ? s.data.message : s.error)
      } catch {
        if (active) {
          setLogin(null)
          setError("Could not check sign-in. Reopen Settings → Models.")
        }
      }
    }
    timer = setTimeout(poll, 1000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [login, close, reload])
  function submit(values: { nickname: string }) {
    if (busy.current || login) return
    setError("")
    const windowRef = edit.rename ? null : window.open("about:blank", "_blank")
    if (windowRef) windowRef.opener = null
    busy.current = true
    start(async () => {
      try {
        const target = row ? { id: row.id, revision: row.revision } : undefined
        if (edit.rename) {
          const r = await renameProfile(values, target)
          if (!r.success) {
            setError(r.error)
            return
          }
          reload()
          close()
          return
        }
        const r = await beginProfileLogin(values, target)
        if (!r.success) {
          windowRef?.close()
          setError(r.error)
          return
        }
        if (windowRef) windowRef.location.replace(r.data.startUrl)
        setLogin({ ...r.data, opened: !!windowRef })
      } catch {
        windowRef?.close()
        setError("Could not start the account operation.")
      } finally {
        busy.current = false
      }
    })
  }
  return (
    <SettingsEditorPane label="ChatGPT account">
      <SettingsFormBody
        id={id}
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
      >
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.nickname}>
            <FieldLabel htmlFor={id + "-name"}>Account nickname</FieldLabel>
            <Input
              id={id + "-name"}
              {...form.register("nickname")}
              placeholder="e.g. Research account"
              readOnly={pending || !!login || (!!row && !edit.rename)}
              aria-invalid={!!form.formState.errors.nickname}
            />
            <FieldError errors={[form.formState.errors.nickname]} />
          </Field>
        </FieldGroup>
        {login && (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            Waiting for ChatGPT.{" "}
            {!login.opened && (
              <a
                href={login.startUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open sign-in page
              </a>
            )}
          </p>
        )}
        <SettingsFormError error={error} />
      </SettingsFormBody>
      <DialogFooter className="m-0 rounded-none">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => requestLeave(close)}
        >
          {login ? "Back" : "Cancel"}
        </Button>
        <Button
          size="sm"
          type="submit"
          form={id}
          disabled={
            pending || !!login || (edit.rename && !form.formState.isDirty)
          }
        >
          {edit.rename ? "Save changes" : "Continue with ChatGPT"}
        </Button>
      </DialogFooter>
      {discardDialog}
    </SettingsEditorPane>
  )
}
