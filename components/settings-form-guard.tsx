"use client"
import {
  useEffect,
  useImperativeHandle,
  useState,
  type Ref,
  type RefObject,
} from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export type SettingsLeaveGuard = (leave: () => void) => void
export function useSettingsFormGuard(
  guard: Ref<SettingsLeaveGuard>,
  isDirty: boolean,
  saving: RefObject<boolean>,
  noun:
    | "bot"
    | "skill"
    | "tool"
    | "connection"
    | "account"
    | "template"
    | "workflow draft"
) {
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null)

  function requestLeave(leave: () => void) {
    if (saving.current) return
    if (isDirty) setLeaveAction(() => leave)
    else leave()
  }
  useImperativeHandle(guard, () => requestLeave)
  useEffect(() => {
    if (!isDirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  const discardDialog = (
    <AlertDialog
      open={!!leaveAction}
      onOpenChange={(open) => {
        if (!open) setLeaveAction(null)
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Your edits to this {noun} will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setLeaveAction(null)
              leaveAction?.()
            }}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { requestLeave, discardDialog }
}
