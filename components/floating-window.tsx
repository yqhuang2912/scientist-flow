"use client"

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import {
  GripIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  constrainDocumentRect,
  initialDocumentRect,
  type WindowRect,
  type Viewport,
} from "@/lib/document-window-layout"
import { cn } from "@/lib/utils"

export function WindowButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function FloatingWindow({
  kind,
  name,
  label,
  icon,
  title,
  actions,
  footer,
  children,
  dirty = false,
  activation,
  closeDisabled,
  onClose,
  onSave,
}: {
  kind: "file" | "workflow"
  name: string
  label: string
  icon: ReactNode
  title?: (compact: boolean) => ReactNode
  actions?: (compact: boolean) => ReactNode
  footer?: ReactNode
  children: ReactNode
  dirty?: boolean
  activation: number
  closeDisabled?: boolean
  onClose: () => void
  onSave?: () => void
}) {
  const helpId = useId()
  const [viewport, setViewport] = useState<Viewport>({
    width: 1200,
    height: 800,
  })
  const [preferredRect, setRect] = useState<WindowRect | null>(null)
  const rect = preferredRect
    ? constrainDocumentRect(preferredRect, viewport)
    : initialDocumentRect(viewport)
  const [maximized, setMaximized] = useState(false)
  const [minimizedAt, setMinimizedAt] = useState<number | null>(null)
  const minimized = minimizedAt === activation
  const windowRef = useRef<HTMLElement>(null)
  const restoreRef = useRef<HTMLButtonElement>(null)

  const drag = useRef<{
    x: number
    y: number
    rect: WindowRect
    resize: boolean
  } | null>(null)

  useEffect(() => {
    function resize() {
      const view = { width: window.innerWidth, height: window.innerHeight }
      setViewport(view)
    }
    resize()
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])

  useEffect(() => {
    const prior = document.activeElement
    return () => {
      if (prior instanceof HTMLElement && prior.isConnected)
        prior.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (minimized) return
    const frame = requestAnimationFrame(() =>
      windowRef.current?.focus({ preventScroll: true })
    )
    return () => cancelAnimationFrame(frame)
  }, [activation, minimized])
  const small = viewport.width <= 640 || viewport.height <= 400
  const bounds = maximized || small ? { x: 0, y: 0, ...viewport } : rect
  const compact = bounds.width < 560
  function beginPointer(event: PointerEvent<HTMLElement>, resize: boolean) {
    if (
      event.button !== 0 ||
      maximized ||
      small ||
      (!resize && event.target !== event.currentTarget)
    )
      return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, rect, resize }
  }
  function movePointer(event: PointerEvent<HTMLElement>) {
    if (!drag.current) return
    const start = drag.current
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y
    setRect(
      constrainDocumentRect(
        start.resize
          ? {
              ...start.rect,
              width: start.rect.width + dx,
              height: start.rect.height + dy,
            }
          : { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy },
        viewport
      )
    )
  }
  const pointerHandlers = {
    onPointerMove: movePointer,
    onPointerUp: () => {
      drag.current = null
    },
    onLostPointerCapture: () => {
      drag.current = null
    },
  }

  return (
    <>
      {minimized && (
        <Button
          ref={restoreRef}
          variant="outline"
          className={cn(
            "fixed right-3 z-40 max-w-[calc(100vw-1.5rem)] gap-2 shadow-md",
            kind === "workflow" ? "bottom-3" : "top-3"
          )}
          onClick={() => setMinimizedAt(null)}
          aria-label={`Restore ${name}`}
        >
          {icon}
          <span className="truncate">{name}</span>
          {dirty && <span aria-label="Unsaved changes">•</span>}
          <Maximize2Icon data-icon="inline-end" />
        </Button>
      )}
      {/* A nonmodal dialog: no backdrop, focus trap, inert background, or outside-dismiss. */}
      <section
        ref={windowRef}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        tabIndex={-1}
        aria-hidden={minimized || undefined}
        inert={minimized}
        className={cn(
          "fixed z-40 flex flex-col overflow-hidden border bg-background text-foreground shadow-xl outline-none",
          !maximized && !small && "rounded-3xl",
          minimized && "pointer-events-none invisible",
          "focus-within:z-[41]"
        )}
        style={{
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
        }}
        onKeyDown={(event) => {
          if (
            onSave &&
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s"
          ) {
            event.preventDefault()
            onSave()
          }
          if (event.key === "Escape" && event.target === windowRef.current)
            onClose()
        }}
      >
        <div
          role="toolbar"
          aria-label={
            kind === "file"
              ? "File window controls"
              : "Workflow window controls"
          }
          tabIndex={0}
          aria-describedby={helpId}
          className={cn(
            "flex h-11 shrink-0 touch-none items-center border-b outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            compact ? "gap-1 px-1.5" : "gap-2 px-3"
          )}
          onPointerDown={(event) => beginPointer(event, false)}
          {...pointerHandlers}
          onKeyDown={(event) => {
            if (
              event.target !== event.currentTarget ||
              maximized ||
              small ||
              !event.key.startsWith("Arrow")
            )
              return
            event.preventDefault()
            const dx =
              event.key === "ArrowRight"
                ? 16
                : event.key === "ArrowLeft"
                  ? -16
                  : 0
            const dy =
              event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0
            setRect(
              constrainDocumentRect(
                event.shiftKey
                  ? {
                      ...rect,
                      width: rect.width + dx,
                      height: rect.height + dy,
                    }
                  : { ...rect, x: rect.x + dx, y: rect.y + dy },
                viewport
              )
            )
          }}
        >
          <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-1">
            {title ? (
              title(compact)
            ) : (
              <>
                {icon}
                <span className="truncate text-sm font-medium">{name}</span>
              </>
            )}
            {dirty && <span aria-label="Unsaved changes">•</span>}
          </div>
          <span id={helpId} className="sr-only">
            Drag the blank title bar to move. With this toolbar focused, use
            arrow keys to move or Shift and arrow keys to resize.
          </span>

          {actions && (
            <div className="flex shrink-0 items-center gap-1">
              {actions(compact)}
            </div>
          )}
          <div className="flex shrink-0 gap-0.5">
            <WindowButton
              label={`Minimize ${kind}`}
              onClick={() => {
                setMinimizedAt(activation)
                requestAnimationFrame(() => restoreRef.current?.focus())
              }}
            >
              <MinusIcon />
            </WindowButton>
            {!small && (
              <WindowButton
                label={maximized ? "Restore window size" : `Maximize ${kind}`}
                onClick={() => setMaximized((value) => !value)}
              >
                {maximized ? <Minimize2Icon /> : <Maximize2Icon />}
              </WindowButton>
            )}
            <WindowButton
              label={`Close ${kind}`}
              disabled={closeDisabled}
              onClick={onClose}
            >
              <XIcon />
            </WindowButton>
          </div>
        </div>

        {children}
        <div
          className={
            footer
              ? "flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 type-meta text-muted-foreground"
              : "absolute right-1 bottom-1"
          }
        >
          {footer}
          {!small && !maximized && (
            <WindowButton
              size="icon-xs"
              label={`Resize ${kind} window`}
              className="touch-none"
              onPointerDown={(event) => beginPointer(event, true)}
              {...pointerHandlers}
              onKeyDown={(event) => {
                if (!event.key.startsWith("Arrow")) return
                event.preventDefault()
                setRect(
                  constrainDocumentRect(
                    {
                      ...rect,
                      width:
                        rect.width +
                        (event.key === "ArrowRight"
                          ? 16
                          : event.key === "ArrowLeft"
                            ? -16
                            : 0),
                      height:
                        rect.height +
                        (event.key === "ArrowDown"
                          ? 16
                          : event.key === "ArrowUp"
                            ? -16
                            : 0),
                    },
                    viewport
                  )
                )
              }}
            >
              <GripIcon />
            </WindowButton>
          )}
        </div>
      </section>
    </>
  )
}
