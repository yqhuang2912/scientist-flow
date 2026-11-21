"use client"

import { useRef, useState } from "react"
import {
  MoreHorizontalIcon,
  PencilIcon,
  SaveIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import type { TaskTemplateSummary } from "@/db/schema"
import { deleteTaskTemplate } from "@/actions/task-template"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { SettingsDeleteAction } from "./settings-detail-actions"
import type { SettingsLeaveGuard } from "./settings-form-guard"
import { TemplateForm, type TemplateChange } from "./templates-settings-panel"

export function WorkflowTemplateMenu({
  template,
  dirty,
  disabled,
  onSave,
  onPublish,
  canPublish,
  onChange,
}: {
  template: TaskTemplateSummary
  dirty: boolean
  disabled: boolean
  onSave: () => void
  onPublish: () => void
  canPublish: boolean
  onChange: TemplateChange
}) {
  const [dialog, setDialog] = useState<"details" | "delete" | null>(null)
  const guard = useRef<SettingsLeaveGuard>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    setDialog(null)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              variant="ghost"
              size="icon-sm"
              aria-label="Template actions"
              title="Template actions"
            />
          }
          disabled={disabled}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={!dirty} onClick={onSave}>
              <SaveIcon /> Save
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canPublish} onClick={onPublish}>
              <UploadIcon /> Publish
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDialog("details")}>
              <PencilIcon /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDialog("delete")}
            >
              <Trash2Icon /> Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={dialog === "details"}
        onOpenChange={(open, event) => {
          if (!open) {
            event.cancel()
            if (guard.current) guard.current(close)
            else close()
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="gap-0 overflow-hidden p-0 sm:max-w-md"
        >
          <DialogTitle className="border-b px-4 py-3">
            Rename template
          </DialogTitle>
          {dialog === "details" && (
            <TemplateForm
              template={template}
              guard={guard}
              close={close}
              onRenamed={(updated) => onChange(updated.id, updated)}
            />
          )}
        </DialogContent>
      </Dialog>
      <SettingsDeleteAction
        noun="template"
        title="Delete template?"
        description={`Permanently delete “${template.name}”?${dirty ? " Its unsaved workflow changes will also be lost." : ""}`}
        dialog={{
          open: dialog === "delete",
          onOpenChange: (open) => (open ? setDialog("delete") : close()),
        }}
        remove={() => deleteTaskTemplate(template.id)}
        onDeleted={() => onChange(template.id, null)}
      />
    </>
  )
}
