"use client"

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from "react"
import {
  FileTextIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  XIcon,
  RefreshCwIcon,
  SaveIcon,
  GripIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DocumentEditor } from "@/components/document-editor"
import { DocumentMarkdown } from "@/components/document-markdown"
import { workspaceOpenPolicy } from "@/lib/workspace-open-policy"
import {
  workspaceFileLanguage,
  workspaceLanguageLabel,
} from "@/lib/workspace-file-language"
import { DocumentSessionStore, isDocumentDirty } from "@/lib/document-session"
import {
  constrainDocumentRect,
  initialDocumentRect,
  type WindowRect,
  type Viewport,
} from "@/lib/document-window-layout"
import { cn } from "@/lib/utils"

function WindowButton({
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

export function DocumentWindow({ session }: { session: DocumentSessionStore }) {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  )
  const doc = state.document
  const dirty = isDocumentDirty(doc)
  const [viewport, setViewport] = useState<Viewport>({
    width: 1200,
    height: 800,
  })
  const [preferredRect, setRect] = useState<WindowRect | null>(null)
  const rect = preferredRect
    ? constrainDocumentRect(preferredRect, viewport)
    : initialDocumentRect(viewport)
  const [maximized, setMaximized] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const windowRef = useRef<HTMLElement>(null)
  const restoreRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const drag = useRef<{
    x: number
    y: number
    rect: WindowRect
    resize: boolean
  } | null>(null)
  const hadDocument = useRef(false)

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
    if (doc) {
      if (!hadDocument.current)
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
      hadDocument.current = true
      // The external session requests window activation, without changing layout or the buffer.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMinimized(false)
      requestAnimationFrame(() =>
        windowRef.current?.focus({ preventScroll: true })
      )
    } else if (hadDocument.current) {
      hadDocument.current = false
      if (returnFocus.current?.isConnected)
        returnFocus.current.focus({ preventScroll: true })
      setRect(null)
      setMaximized(false)
    }
    // Buffer changes must not steal focus from the editor or the background chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activation, !!doc])
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [dirty])

  if (!doc) return null
  const small = viewport.width <= 640 || viewport.height <= 400
  const bounds = maximized || small ? { x: 0, y: 0, ...viewport } : rect
  const name = doc.relativePath.split("/").at(-1)!
  const language = workspaceFileLanguage(doc.relativePath)
  const policy = workspaceOpenPolicy(doc.relativePath)
  // Markdown keeps a preview of its own: rendering it in place loses the
  // things that make the format worth reading — math set as math, fenced code
  // in its own surface, tables as tables. Code files have no second form, so
  // they stay on the single editing surface.
  const markdown = policy.kind === "internal-text" && policy.markdown
  const preview = markdown && doc.mode === "preview"
  const locked = !!state.intent || !!state.deletion
  const canSave =
    dirty &&
    !!doc.version &&
    !doc.loading &&
    !doc.saving &&
    !doc.missing &&
    !doc.conflict &&
    !state.deletion

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
  const status = doc.saving
    ? "Saving…"
    : doc.loading
      ? "Loading…"
      : state.deletion
        ? "Deletion awaiting confirmation"
        : (doc.error ??
          (doc.conflict
            ? "Draft kept. The disk version has changed."
            : dirty
              ? "Unsaved changes"
              : doc.saved
                ? "Saved"
                : "No changes"))

  return (
    <>
      {minimized && (
        <Button
          ref={restoreRef}
          variant="outline"
          className="fixed top-3 right-3 z-40 max-w-[calc(100vw-1.5rem)] gap-2 shadow-md"
          onClick={() => session.activate()}
          aria-label={`Restore ${name}`}
        >
          <FileTextIcon data-icon="inline-start" />
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
        aria-labelledby="document-title"
        tabIndex={-1}
        hidden={minimized}
        className={cn(
          "fixed z-40 flex flex-col overflow-hidden border bg-background text-foreground shadow-xl outline-none",
          !maximized && !small && "rounded-3xl",
          minimized && "hidden"
        )}
        style={{
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
        }}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s"
          ) {
            event.preventDefault()
            if (canSave) void session.save()
          }
          if (event.key === "Escape" && event.target === windowRef.current)
            session.requestClose()
        }}
      >
        <div
          role="toolbar"
          aria-label="File window controls"
          tabIndex={0}
          aria-describedby="document-move-help"
          className="flex h-11 shrink-0 touch-none items-center gap-2 border-b px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
          <FileTextIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span
            id="document-title"
            className="pointer-events-none flex min-w-0 flex-1 items-center gap-1 text-[13px] leading-[1.5] font-medium select-none"
          >
            <span className="pointer-events-auto truncate select-text" title={name}>
              {name}
            </span>
            {dirty && (
              <span
                className="shrink-0 text-muted-foreground"
                aria-label="Unsaved changes"
              >
                •
              </span>
            )}
          </span>
          <span id="document-move-help" className="sr-only">
            Drag the blank title bar to move. With this toolbar focused, use
            arrow keys to move or Shift and arrow keys to resize.
          </span>
          <div className="ml-auto flex shrink-0 gap-0.5">
            <WindowButton
              label="Minimize file"
              onClick={() => {
                setMinimized(true)
                requestAnimationFrame(() => restoreRef.current?.focus())
              }}
            >
              <MinusIcon />
            </WindowButton>
            <WindowButton
              label={maximized ? "Restore window size" : "Maximize file"}
              disabled={small}
              onClick={() => setMaximized((value) => !value)}
            >
              {maximized ? <Minimize2Icon /> : <Maximize2Icon />}
            </WindowButton>
            <WindowButton
              label="Close file"
              disabled={doc.saving || !!state.deletion}
              onClick={session.requestClose}
            >
              <XIcon />
            </WindowButton>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1">
          <p className="max-h-12 min-w-0 flex-[1_0_min(100%,12rem)] overflow-y-auto text-xs leading-4 wrap-anywhere text-muted-foreground">
            <span className="font-medium">{doc.taskName}</span>
            <span aria-hidden> / </span>
            {doc.relativePath}
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {markdown && (
              <ToggleGroup
                size="sm"
                value={[doc.mode]}
                onValueChange={(values) => {
                  if (values[0])
                    session.setMode(values[0] as "preview" | "source")
                }}
                aria-label="Document view"
              >
                <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
                <ToggleGroupItem value="source">Edit</ToggleGroupItem>
              </ToggleGroup>
            )}
            <WindowButton
              label="Reload from disk"
              disabled={doc.loading || doc.saving || locked}
              onClick={session.requestReload}
            >
              <RefreshCwIcon />
            </WindowButton>
            <Button
              size="sm"
              disabled={!canSave || locked}
              onClick={() => void session.save()}
            >
              {doc.saving ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SaveIcon data-icon="inline-start" />
              )}
              Save
            </Button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {doc.loading && (
            <div
              role="status"
              className="flex items-center gap-2 p-6 text-[13px] text-muted-foreground"
            >
              <Spinner />
              Loading file…
            </div>
          )}
          {/* The editor stays mounted while previewing so switching back keeps
              the selection, scroll position, and undo history. */}
          <div hidden={doc.loading || preview} className="h-full">
            <DocumentEditor
              key={`${doc.chatId}/${doc.relativePath}`}
              value={doc.buffer}
              language={language}
              readOnly={locked || !doc.version}
              label={`Contents of ${name}`}
              onChange={session.edit}
              onSave={() => {
                if (canSave) void session.save()
              }}
            />
          </div>
          {!doc.loading && preview && (
            <div className="h-full overflow-auto px-5 py-6 sm:px-8 sm:py-8">
              <DocumentMarkdown content={doc.buffer} />
            </div>
          )}
        </div>
        <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 type-meta text-muted-foreground">
          <span
            role="status"
            className={cn(
              "min-w-0 flex-1 wrap-anywhere",
              doc.error && "text-destructive"
            )}
          >
            {status}
          </span>
          {doc.conflict && (
            <>
              {doc.error && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={locked}
                  onClick={session.keepDraft}
                >
                  Keep draft
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                disabled={locked}
                onClick={session.requestReload}
              >
                Reload disk version
              </Button>
            </>
          )}
          <span>
            {workspaceLanguageLabel(language)} ·{" "}
            {doc.bom ? "UTF-8 BOM" : "UTF-8"} / {doc.newline}
          </span>
          {!small && !maximized && (
            <WindowButton
              size="icon-xs"
              label="Resize file window"
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
      <AlertDialog
        open={!!state.intent}
        onOpenChange={(open) => {
          if (!open && !doc.saving) session.cancelIntent()
        }}
      >
        <AlertDialogContent
          initialFocus={cancelRef}
          className="overflow-hidden data-[size=default]:sm:max-w-md"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {name} has unsaved changes.
              {state.intent?.kind === "delete"
                ? " Save them before continuing to deletion, or discard them if deletion succeeds."
                : " Save them before continuing, or discard your changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {doc.error && (
            <p role="alert" className="text-xs text-destructive">
              {doc.error}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              ref={cancelRef}
              variant="outline"
              disabled={doc.saving}
              onClick={session.cancelIntent}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={doc.saving}
              onClick={() => void session.resolveIntent("discard")}
            >
              Discard changes
            </Button>
            <Button
              disabled={
                doc.saving || !doc.version || doc.missing || doc.conflict
              }
              onClick={() => void session.resolveIntent("save")}
            >
              {doc.saving && <Spinner data-icon="inline-start" />}Save and
              continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
