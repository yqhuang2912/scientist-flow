"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { FolderIcon, AlertTriangleIcon, MoveRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
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

interface WorkspaceSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: WorkspaceSettingsDialogProps) {
  const [rootDir, setRootDir] = useState("")
  // The value saved on the server (null = never saved)
  const [savedDir, setSavedDir] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Warn when the entered directory is not empty
  const [notEmptyWarn, setNotEmptyWarn] = useState(false)
  // Migrate confirm popover open state
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [isMigrating, startMigrate] = useTransition()
  const [migrateError, setMigrateError] = useState<string | null>(null)
  // Debounce dir empty check
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isEditing = !!savedDir
  const isDirty = rootDir.trim() !== (savedDir ?? "")

  // Load current config when dialog opens
  useEffect(() => {
    if (!open) return
    getWorkspaceConfigAction().then((res) => {
      if (res.success && res.rootDir) {
        setRootDir(res.rootDir)
        setSavedDir(res.rootDir)
        setError(null)
      } else if (!res.success) {
        setError(res.error)
        setSavedDir(null)
      } else {
        setError(null)
        setSavedDir(null)
      }
      setNotEmptyWarn(false)
      setConfirmOpen(false)
      setMigrateError(null)
    })
  }, [open])

  // Check if directory is empty whenever rootDir changes (debounced)
  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current)
    if (!rootDir.trim()) {
      checkTimerRef.current = setTimeout(() => setNotEmptyWarn(false), 0)
      return () => { if (checkTimerRef.current) clearTimeout(checkTimerRef.current) }
    }
    checkTimerRef.current = setTimeout(async () => {
      setNotEmptyWarn(false)
      const res = await checkDirEmptyAction(rootDir.trim())
      if (res.success && !res.isEmpty) {
        setNotEmptyWarn(true)
      }
    }, 500)
    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current)
    }
  }, [rootDir])

  // ── First-time save (no existing config) ────────────────────────────────────
  function handleFirstSave() {
    setError(null)
    startTransition(async () => {
      const result = await saveWorkspaceConfigAction(rootDir.trim())
      if (!result.success) {
        setError(result.error)
        return
      }
      setSavedDir(rootDir.trim())
      onSaved?.()
      onOpenChange(false)
    })
  }

  // ── Migration (existing config → new dir) ───────────────────────────────────
  function handleMigrate() {
    setMigrateError(null)
    setConfirmOpen(false)
    startMigrate(async () => {
      const result = await migrateWorkspaceRootAction(rootDir.trim())
      if (!result.success) {
        setMigrateError(result.error)
        return
      }
      if (result.errors.length > 0) {
        setMigrateError(
          `Migration partially failed: ${result.errors.map((e) => `${e.chatId}: ${e.message}`).join("; ")}`
        )
        return
      }
      setSavedDir(rootDir.trim())
      onSaved?.()
      onOpenChange(false)
    })
  }

  const anyPending = isPending || isMigrating

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-4 pb-0 sm:max-w-lg">
        <DialogHeader className="gap-1 pb-4">
          <DialogTitle className="text-sm">Workspace settings</DialogTitle>
          <DialogDescription className="text-xs">
            {isEditing
              ? "Change the root directory. All existing task workspaces will be moved to the new location."
              : "Set the root directory where task workspaces are stored on this machine. Enter a path to an existing directory."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 pb-4">
          {savedDir && (
            <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-mono truncate">{savedDir}</span>
              {isDirty && (
                <>
                  <MoveRightIcon className="size-3.5 shrink-0" />
                  <span className="font-mono truncate text-foreground">{rootDir}</span>
                </>
              )}
            </div>
          )}

          <Field>
            <FieldLabel htmlFor="workspace-root" className="flex items-center gap-1.5">
              <FolderIcon className="size-3.5" />
              {isEditing ? "New root directory" : "Root directory"}
            </FieldLabel>
            <Input
              id="workspace-root"
              value={rootDir}
              onChange={(e) => {
                setRootDir(e.target.value)
                setError(null)
                setMigrateError(null)
              }}
              placeholder={
                process.platform === "win32"
                  ? "C:\\Users\\you\\workspaces"
                  : "/home/you/workspaces"
              }
              disabled={anyPending}
              className="font-mono text-xs"
            />
            {(error ?? migrateError) && (
              <FieldError errors={[{ message: (error ?? migrateError)! }]} />
            )}
          </Field>

          {notEmptyWarn && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
              <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
              <span>
                This directory is not empty. Existing files will be kept — new task
                workspaces will be created as subdirectories alongside them.
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="mt-0 mb-0 flex-row justify-end">
          <DialogClose
            render={
              <Button type="button" variant="outline" disabled={anyPending} />
            }
          >
            Cancel
          </DialogClose>

          {/* First-time save — no existing config */}
          {!isEditing && (
            <Button
              type="button"
              disabled={anyPending || !rootDir.trim()}
              onClick={handleFirstSave}
            >
              {isPending && <Spinner data-icon="inline-start" />}
              Save
            </Button>
          )}

          {/* Change existing config — requires confirmation popover */}
          {isEditing && (
            <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    disabled={anyPending || !rootDir.trim() || !isDirty}
                  />
                }
              >
                {isMigrating ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Moving…
                  </>
                ) : (
                  "Change directory"
                )}
              </PopoverTrigger>
              <PopoverContent side="top" className="w-80">
                <p className="text-sm font-medium">Move all task workspaces?</p>
                <p className="text-xs text-muted-foreground">
                  Every initialised task directory will be moved from{" "}
                  <span className="font-mono break-all">{savedDir}</span> to{" "}
                  <span className="font-mono break-all">{rootDir}</span>.
                  This cannot be undone.
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleMigrate}
                  >
                    Move and save
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
