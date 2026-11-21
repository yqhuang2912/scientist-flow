"use client"

import { useState, useTransition } from "react"
import { Trash2Icon } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function SettingsDeleteAction<T extends { success: true }>({
  noun,
  title,
  description,
  remove,
  onDeleted,
  standalone = false,
  disabled = false,
  actionLabel = "Delete",
  dialog,
}: {
  noun: string
  title: string
  description: string
  remove: () => Promise<T | { success: false; error: string }>
  onDeleted: (result: T) => void
  standalone?: boolean
  disabled?: boolean
  actionLabel?: string
  dialog?: { open: boolean; onOpenChange: (open: boolean) => void }
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = dialog?.open ?? internalOpen
  const setOpen = dialog?.onOpenChange ?? setInternalOpen
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()

  function confirm() {
    if (pending) return
    setError("")
    startTransition(async () => {
      try {
        const result = await remove()
        if (result.success) {
          setOpen(false)
          onDeleted(result)
        } else setError(result.error)
      } catch {
        setError("Could not reach the server. Please try again.")
      }
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setError("")
        setOpen(next)
      }}
    >
      {!dialog && (
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              variant={standalone ? "destructive" : "ghost"}
              size="sm"
              disabled={disabled || pending}
              className={standalone ? "mr-auto" : "text-destructive"}
            />
          }
        >
          <Trash2Icon data-icon="inline-start" />
          {standalone ? actionLabel + " " + noun : actionLabel}
        </AlertDialogTrigger>
      )}
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="wrap-anywhere">{title}</AlertDialogTitle>
          <AlertDialogDescription className="wrap-anywhere">
            {description}
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={confirm}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {actionLabel} {noun}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
