"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  navigationItemStyles,
  navigationItemStates,
} from "@/components/ui/compact-styles"

/**
 * Compact settings shell: a fixed-width navigation column on the left and a
 * single column of rows on the right. Rows sit on hairline dividers with no
 * card chrome, matching the rest of the workspace surfaces.
 */
export function SettingsShell({
  nav,
  children,
  className,
}: {
  nav: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid min-h-[19rem] grid-cols-1 sm:grid-cols-[9.5rem_minmax(0,1fr)]",
        className
      )}
    >
      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-0.5 border-b p-2 pr-12 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0 sm:pr-2"
      >
        {nav}
      </nav>
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
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
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      className={cn(
        navigationItemStyles,
        navigationItemStates,
        "h-7.5 w-auto min-w-0 justify-start gap-1.5 sm:w-full",
        !active && "text-sidebar-foreground"
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </Button>
  )
}

export function SettingsSection({
  title,
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      {title && (
        <p className="px-4 pt-4 pb-2 text-xs font-medium text-muted-foreground">
          {title}
        </p>
      )}
      <div className="flex flex-col px-4">{children}</div>
    </div>
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

/** A control pill sized to the shared 30px row scale. */
export function SettingsControl({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={disabled}
      className={cn("min-w-[5.5rem] justify-between gap-2 px-2.5", className)}
    >
      {children}
    </Button>
  )
}
