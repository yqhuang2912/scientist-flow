"use client"

import { useMemo, useState } from "react"
import { CheckIcon, GitBranchIcon } from "lucide-react"
import {
  versionTreeRows,
  type TemplateVersionState,
} from "@/lib/workflow-version-tree"
import { cn } from "@/lib/utils"
import { Button } from "./ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog"

const x = (lane: number) => 9 + lane * 13

export function WorkflowVersions({
  state,
  busy,
  hasDraftChanges,
  onSwitch,
}: {
  state: TemplateVersionState
  busy: boolean
  hasDraftChanges: boolean
  onSwitch: (version: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<number | null>(null)
  const rows = useMemo(() => versionTreeRows(state.releases), [state.releases])
  const width = rows.reduce((w, row) => Math.max(w, x(row.lane) + 9), 18)
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              title="Workflow versions"
              aria-label="Workflow versions"
            />
          }
        >
          <GitBranchIcon />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 max-w-[calc(100vw-1.5rem)] gap-1 p-1.5"
        >
          <PopoverHeader className="px-2.5 py-2">
            <PopoverTitle>Version history</PopoverTitle>
          </PopoverHeader>
          {rows.length === 0 ? (
            <p className="px-2.5 pb-3 text-sm text-muted-foreground">
              Publish the workflow to create v1.
            </p>
          ) : (
            <ol
              aria-label="Workflow version tree"
              className="max-h-80 overflow-auto"
            >
              {rows.map((row) => {
                const current = row.version === state.currentVersion
                return (
                  <li key={row.version}>
                    <button
                      type="button"
                      aria-current={current ? "true" : undefined}
                      aria-label={
                        current
                          ? `v${row.version}, current version`
                          : `Use v${row.version}`
                      }
                      disabled={busy}
                      onClick={() => {
                        if (current) return
                        if (hasDraftChanges) {
                          setOpen(false)
                          setConfirm(row.version)
                        } else onSwitch(row.version)
                      }}
                      className={cn(
                        "flex h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                        current && "bg-muted/65"
                      )}
                    >
                      <svg
                        aria-hidden
                        width={width}
                        height="44"
                        className="shrink-0 text-muted-foreground/70"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        {row.incoming.map((i) => (
                          <path
                            key={i}
                            d={`M${x(i)} 0 V${i === row.lane ? 22 : 44}`}
                          />
                        ))}
                        {row.parentLane !== null && (
                          <path
                            d={`M${x(row.lane)} 22 C${x(row.lane)} 34 ${x(row.parentLane)} 32 ${x(row.parentLane)} 44`}
                          />
                        )}
                        <circle
                          cx={x(row.lane)}
                          cy={22}
                          r="3.5"
                          className={
                            current
                              ? "fill-primary stroke-primary"
                              : "fill-popover"
                          }
                        />
                      </svg>
                      <span className="shrink-0 font-medium tabular-nums">
                        v{row.version}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                        title={new Date(row.publishedAt).toLocaleString()}
                      >
                        {row.parentVersion
                          ? `from v${row.parentVersion}`
                          : "Initial version"}
                      </span>
                      {current && (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
                          <CheckIcon className="size-3.5" /> Current
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </PopoverContent>
      </Popover>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next) setConfirm(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to v{confirm}?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the unpublished draft with v{confirm}. Cancel to
              keep editing or publish the draft first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm !== null) {
                  onSwitch(confirm)
                  setConfirm(null)
                  setOpen(true)
                }
              }}
            >
              Switch version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
