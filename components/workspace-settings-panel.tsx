"use client"

import { useEffect, useState, useTransition } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useWatch } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  getWorkspaceConfigAction,
  saveWorkspaceConfigAction,
  checkDirEmptyAction,
  migrateWorkspaceRootAction,
} from "@/actions/workspace"
import {
  WORKSPACE_ROOT_NOT_EMPTY,
  workspaceRootFormSchema,
} from "@/lib/workspace-validation"

/** Mount only while the settings pane is visible; load config on mount. */
export function WorkspaceSettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const form = useForm({
    resolver: zodResolver(workspaceRootFormSchema),
    defaultValues: { rootDir: "" },
  })
  const { reset } = form
  const rootDir = useWatch({ control: form.control, name: "rootDir" })
  const candidate = rootDir.trim()
  const [savedDir, setSavedDir] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directoryCheck, setDirectoryCheck] = useState<{
    path: string
    isEmpty?: boolean
    error?: string
  } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const isEditing = !!savedDir
  const isDirty = candidate !== (savedDir ?? "")
  const check = directoryCheck?.path === candidate ? directoryCheck : null
  const canSubmit = loaded && isDirty && check?.isEmpty === true && !isPending
  const fieldError =
    error ??
    form.formState.errors.rootDir?.message ??
    check?.error ??
    (check?.isEmpty === false ? WORKSPACE_ROOT_NOT_EMPTY : undefined)

  useEffect(() => {
    let active = true
    getWorkspaceConfigAction()
      .then((result) => {
        if (!active) return
        if (result.success) {
          reset({ rootDir: result.rootDir ?? "" })
          setSavedDir(result.rootDir)
        } else {
          setError(result.error)
        }
        setLoaded(true)
      })
      .catch(() => {
        if (!active) return
        setError("Could not load the root directory. Reopen settings to retry.")
      })
    return () => {
      active = false
    }
  }, [reset])

  useEffect(() => {
    const checkedPath = rootDir.trim()
    if (!checkedPath) return
    let active = true
    const timer = setTimeout(async () => {
      try {
        const result = await checkDirEmptyAction(checkedPath)
        if (!active) return
        setDirectoryCheck({
          path: checkedPath,
          ...(result.success
            ? { isEmpty: result.isEmpty }
            : { error: result.error }),
        })
      } catch {
        if (active) {
          setDirectoryCheck({
            path: checkedPath,
            error: "Could not check this directory. Try again.",
          })
        }
      }
    }, 350)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [rootDir])

  function saveRoot({ rootDir: target }: { rootDir: string }) {
    if (!canSubmit) return
    setError(null)
    setConfirmOpen(false)
    startTransition(async () => {
      try {
        const result = isEditing
          ? await migrateWorkspaceRootAction(target)
          : { ...(await saveWorkspaceConfigAction(target)), errors: [] }
        if (!result.success) {
          setError(result.error)
          return
        }
        if (result.errors.length > 0) {
          setError(
            "Migration partially failed: " +
              result.errors
                .map((entry) => entry.chatId + ": " + entry.message)
                .join("; ")
          )
          return
        }
        setSavedDir(target)
        onSaved?.()
      } catch {
        setError("Could not save the root directory. Try again.")
      }
    })
  }

  return (
    <div className="flex flex-col px-4 pb-4">
      <div className="flex flex-col gap-1 py-3.5">
        <div className="flex flex-col gap-1 sm:pr-6">
          <h3 className="shrink-0 type-section-title">Root directory</h3>
          <span className="min-w-0 font-mono text-xs break-all text-muted-foreground">
            {loaded ? (savedDir ?? "Not set") : "Loading…"}
          </span>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          {isEditing
            ? "Choose an empty directory to move all task workspaces."
            : "Choose an empty directory for your task workspaces."}
        </p>
      </div>
      <Separator />

      <form
        className="flex flex-col gap-4 pt-3.5"
        onSubmit={form.handleSubmit((values) => {
          if (!canSubmit) return
          if (isEditing) setConfirmOpen(true)
          else saveRoot(values)
        })}
      >
        <FieldGroup>
          <Field
            data-invalid={!!fieldError}
            data-disabled={!loaded || isPending}
          >
            <FieldLabel htmlFor="workspace-root">
              {isEditing ? "New path" : "Path"}
            </FieldLabel>
            <Input
              id="workspace-root"
              {...form.register("rootDir", {
                onChange: () => {
                  setError(null)
                  setDirectoryCheck(null)
                  setConfirmOpen(false)
                },
              })}
              placeholder="Absolute directory path"
              disabled={!loaded || isPending}
              aria-invalid={!!fieldError}
              aria-describedby={fieldError ? "workspace-root-error" : undefined}
              className="font-mono"
            />
            {fieldError && (
              <FieldError id="workspace-root-error">{fieldError}</FieldError>
            )}
          </Field>
        </FieldGroup>

        <div className="flex justify-center">
          {!isEditing ? (
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {isPending && <Spinner data-icon="inline-start" />}
              Save
            </Button>
          ) : (
            <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
              <PopoverTrigger
                render={
                  <Button type="button" size="sm" disabled={!canSubmit} />
                }
              >
                {isPending ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Moving…
                  </>
                ) : (
                  "Change directory"
                )}
              </PopoverTrigger>
              <PopoverContent side="top" className="w-80">
                <p className="text-[13px] font-medium">
                  Move all task workspaces?
                </p>
                <p className="text-sm leading-5 text-muted-foreground">
                  All task directories will move to the new location.
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => setConfirmOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canSubmit}
                    onClick={form.handleSubmit(saveRoot)}
                  >
                    Move and save
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </form>
    </div>
  )
}
