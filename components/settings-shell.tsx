"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { DialogContent, DialogFooter } from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  navigationItemStyles,
  navigationItemStates,
} from "@/components/ui/compact-styles"

export function SettingsDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        "h-[min(36rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-3xl",
        className
      )}
      {...props}
    />
  )
}

export function SettingsShell({
  nav,
  children,
}: {
  nav: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:grid-rows-1">
      <nav
        aria-label="Settings sections"
        className="flex items-center justify-around gap-0.5 border-b px-2 py-1 sm:flex-col sm:items-stretch sm:justify-start sm:overflow-y-auto sm:border-r sm:border-b-0 sm:py-2"
      >
        {nav}
      </nav>
      {children}
    </div>
  )
}

export function SettingsPane({
  className,
  children,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className="min-h-0 min-w-0 [scrollbar-gutter:stable] overflow-y-auto overscroll-contain"
      {...props}
    >
      <div className={cn("flex min-w-0 flex-col p-4", className)}>
        {children}
      </div>
    </section>
  )
}

export function SettingsFormBody(props: React.ComponentProps<"form">) {
  return (
    <form
      {...props}
      className={cn(
        "min-h-0 min-w-0 [scrollbar-gutter:stable] overflow-y-auto overscroll-contain p-4 max-md:[&_[data-slot=input]]:type-control max-md:[&_[data-slot=textarea]]:type-control-compact",
        props.className
      )}
    />
  )
}

export function SettingsFormFooter({
  children,
  formId,
  noun,
  editing,
  dirty,
  pending,
  ready = true,
  submitLabel,
  onCancel,
}: {
  children?: React.ReactNode
  formId: string
  noun: "bot" | "skill" | "tool" | "connection" | "gateway" | "template"
  editing: boolean
  dirty: boolean
  pending: boolean
  ready?: boolean
  submitLabel?: string
  onCancel: () => void
}) {
  const unchanged = editing && !dirty
  return (
    <DialogFooter className="mx-0 mb-0 flex-row flex-wrap justify-end rounded-none max-sm:gap-1 max-sm:px-2 max-sm:[&>button]:px-2">
      {children && <div className="mr-auto">{children}</div>}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        type="submit"
        form={formId}
        variant={unchanged ? "secondary" : "default"}
        disabled={pending || !ready || unchanged}
      >
        {pending && <Spinner />}
        {submitLabel ?? (editing ? "Save changes" : "Create " + noun)}
      </Button>
    </DialogFooter>
  )
}

export function SettingsNavItem({
  active,
  icon,
  children,
  onClick,
}: {
  active?: boolean
  icon: React.ReactNode
  children: string
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            onClick={onClick}
            aria-label={children}
            aria-current={active ? "page" : undefined}
            data-active={active || undefined}
            className={cn(
              navigationItemStyles,
              navigationItemStates,
              "size-10 min-w-0 gap-1.5 max-sm:rounded-full max-sm:p-0 sm:h-7.5 sm:w-full sm:justify-start",
              !active && "text-sidebar-foreground"
            )}
          />
        }
      >
        {icon}
        <span className="hidden min-w-0 truncate sm:inline">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="sm:hidden">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * One settings row: label and description on the left, control on the right.
 * Rows carry a bottom hairline and drop it on the last child.
 */
export function SettingsRow({
  label,
  description,
  control,
  className,
}: {
  label: string
  description?: string
  control: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-between gap-2 border-b border-border py-3.5 last:border-b-0 sm:flex-row sm:gap-4",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-control">{label}</span>
        {description && (
          <span className="text-sm leading-5 text-muted-foreground">
            {description}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center">{control}</div>
    </div>
  )
}

/** The editor pane that replaces the list once a row is opened. */
export function SettingsEditorPane({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-label={label}
      className="flex min-h-0 min-w-0 flex-col [&>form]:flex-1"
    >
      {children}
    </section>
  )
}

/**
 * The one server-action failure line used by every editor, so a save error
 * reads identically in Settings, the task dialog and bot memory. Call sites
 * own their own spacing.
 */
export function SettingsFormError({
  error,
  className,
}: {
  error: string
  className?: string
}) {
  if (!error) return null
  return (
    <p role="alert" className={cn("text-sm text-destructive", className)}>
      {error}
    </p>
  )
}
