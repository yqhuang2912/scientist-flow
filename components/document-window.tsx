"use client"

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { EyeIcon, PencilIcon, RefreshCwIcon, SaveIcon } from "lucide-react"
import { FloatingWindow, WindowButton } from "@/components/floating-window"
import { Button } from "@/components/ui/button"
import { FileTypeIcon } from "@/components/file-type-icon"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DocumentEditor } from "@/components/document-editor"
import { formatDatasetJson } from "@/lib/workspace-json-preview"
import { DocumentMarkdown } from "@/components/document-markdown"
import { workspaceOpenPolicy } from "@/lib/workspace-open-policy"
import {
  workspaceFileLanguage,
  workspaceLanguageLabel,
} from "@/lib/workspace-file-language"
import { DocumentSessionStore, isDocumentDirty } from "@/lib/document-session"
import { cn } from "@/lib/utils"

export function DocumentWindow({ session }: { session: DocumentSessionStore }) {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  )
  const doc = state.document
  const buffer = doc?.buffer ?? ""
  const formatJson = doc?.readOnly && !doc.truncated
  const displayed = useMemo(
    () => (formatJson ? formatDatasetJson(buffer) : buffer),
    [formatJson, buffer]
  )
  const dirty = isDocumentDirty(doc)
  const cancelRef = useRef<HTMLButtonElement>(null)
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
  const name = doc.relativePath.split("/").at(-1)!
  const parentPath = doc.relativePath.slice(0, -name.length)
  const identity = `${doc.taskName} / ${doc.relativePath}`
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
                : doc.readOnly
                  ? doc.truncated
                    ? "Read-only preview · First 256 KiB"
                    : "Read-only preview"
                  : "No changes"))

  return (
    <>
      <FloatingWindow
        kind="file"
        name={name}
        label={identity}
        dirty={dirty}
        activation={state.activation}
        icon={<FileTypeIcon filename={name} data-icon="inline-start" />}
        closeDisabled={doc.saving || !!state.deletion}
        onClose={session.requestClose}
        onSave={() => {
          if (canSave) void session.save()
        }}
        title={(compact) => (
          <Popover>
            <PopoverTrigger
              render={<Button variant="ghost" size="compact" />}
              className="pointer-events-auto max-w-full min-w-0 shrink justify-start"
              aria-label={identity}
              id="document-title"
            >
              <FileTypeIcon filename={name} data-icon="inline-start" />
              {!compact && (
                <span className="max-w-[45%] truncate text-muted-foreground">
                  {doc.taskName} / {parentPath}
                </span>
              )}
              <span className="min-w-0 truncate">{name}</span>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-w-[calc(100vw-1rem)]">
              <PopoverTitle className="wrap-anywhere">
                {doc.taskName}
              </PopoverTitle>
              <p className="wrap-anywhere text-muted-foreground">
                {doc.relativePath}
              </p>
            </PopoverContent>
          </Popover>
        )}
        actions={(compact) => (
          <>
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
                <ToggleGroupItem
                  value="preview"
                  aria-label="Preview"
                  title="Preview"
                  className={compact ? "size-7.5 rounded-full p-0" : undefined}
                >
                  {compact ? <EyeIcon /> : "Preview"}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="source"
                  aria-label="Edit"
                  title="Edit"
                  className={compact ? "size-7.5 rounded-full p-0" : undefined}
                >
                  {compact ? <PencilIcon /> : "Edit"}
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <WindowButton
              label="Reload from disk"
              disabled={doc.loading || doc.saving || locked}
              onClick={session.requestReload}
            >
              <RefreshCwIcon />
            </WindowButton>
            {!doc.readOnly && (
              <Button
                size={compact ? "icon-sm" : "sm"}
                aria-label="Save"
                title="Save"
                disabled={!canSave || locked}
                onClick={() => void session.save()}
              >
                {doc.saving ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SaveIcon data-icon="inline-start" />
                )}
                {!compact && "Save"}
              </Button>
            )}
          </>
        )}
        footer={
          <>
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
          </>
        }
      >
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
              value={displayed}
              language={language}
              readOnly={!!doc.readOnly || locked || !doc.version}
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
      </FloatingWindow>
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
