"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { flushSync } from "react-dom"
import { SHOW_REPLY_EVIDENCE } from "@/lib/chat-revision"
import { BookMarkedIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react"
import {
  listProjectDecisions,
  withdrawDecision,
} from "@/actions/project-decisions"
import type { ProjectDecision } from "@/db/schema"
import { projectDecisionLimit, toolCallAnchor } from "@/lib/project-decisions"
import { ProjectToolSource } from "@/components/project-tool-source"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"

function DecisionList({
  chatId,
  recordId,
  showSource,
}: {
  chatId: string
  recordId?: string
  showSource: (record: ProjectDecision) => boolean
}) {
  const [rows, setRows] = useState<ProjectDecision[] | null>(null)
  const [error, setError] = useState("")
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [pending, startTransition] = useTransition()
  useEffect(() => {
    let current = true
    listProjectDecisions(chatId, recordId)
      .then((result) => {
        if (!current) return
        if (result.success) setRows(result.rows)
        else setError(result.error)
      })
      .catch(() => {
        if (current) setError("Could not load project decisions.")
      })
    return () => {
      current = false
    }
  }, [chatId, recordId, revision])
  function remove(id: string) {
    startTransition(async () => {
      try {
        const result = await withdrawDecision(chatId, id)
        if (!result.success) {
          setError(result.error)
          return
        }
        setRows((old) => old?.filter((row) => row.id !== id) ?? null)
        toast.add({ type: "success", title: "Decision withdrawn" })
      } catch {
        setError("Could not withdraw the decision. Please retry.")
      }
    })
  }
  return (
    <>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-destructive"
        >
          {error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRows(null)
              setError("")
              setRevision((r) => r + 1)
            }}
          >
            Reload
          </Button>
        </div>
      )}
      {!rows ? (
        !error && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Spinner />
            Loading decisions…
          </p>
        )
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">
          {recordId
            ? "This decision is no longer active in this project."
            : "No active research decisions."}
        </p>
      ) : (
        <ol className="min-h-0 divide-y overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {row.id}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Withdraw decision"
                  aria-label={"Withdraw " + row.id}
                  disabled={pending}
                  onClick={() => {
                    setError("")
                    remove(row.id)
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <p className="text-sm font-medium wrap-anywhere">
                {row.decision}
              </p>
              <p className="text-xs text-muted-foreground">
                Recorded by {row.creatorName} ·{" "}
                <time dateTime={row.createdAt.toISOString()}>
                  {row.createdAt.toLocaleString()}
                </time>
              </p>
              {row.toolEvidence ? (
                <ProjectToolSource evidence={row.toolEvidence} />
              ) : (
                <blockquote className="space-y-1 border-l-2 pl-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    {row.sourceRole === "user"
                      ? "User report"
                      : "Bot report · " + row.sourceAuthor}
                  </span>
                  <p className="wrap-anywhere whitespace-pre-wrap">
                    {row.quote}
                  </p>
                </blockquote>
              )}
              {row.nextStep && (
                <p className="text-sm wrap-anywhere">
                  <span className="text-muted-foreground">Next step · </span>
                  {row.nextStep}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!showSource(row)) setUnavailable(row.id)
                }}
              >
                <ExternalLinkIcon />
                View source
              </Button>
              {unavailable === row.id && (
                <p role="status" className="text-xs text-muted-foreground">
                  Source message unavailable in the loaded conversation. The
                  saved evidence is shown above.
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

export function ProjectMemoryButton({
  chatId,
  recordId,
  label,
}: {
  chatId: string
  recordId?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const source = useRef<HTMLElement | null>(null)
  function showSource(record: ProjectDecision) {
    const chat = document.querySelector(
      `[data-project-chat="${CSS.escape(chatId)}"]`
    )
    const findPart = () => record.toolEvidence
      ? chat?.querySelector<HTMLElement>(
          "#" +
            CSS.escape(
              toolCallAnchor(
                record.sourceMessageId,
                record.toolEvidence.toolCallId
              )
            )
        )
      : chat?.querySelector<HTMLElement>(
          `[data-evidence-message="${CSS.escape(record.sourceMessageId)}"] [data-evidence-part="${record.sourcePart}"]`
        )
    if (!chat || record.chatId !== chatId) return false
    let part = findPart()
    if (!part) {
      flushSync(() => chat.dispatchEvent(new CustomEvent(SHOW_REPLY_EVIDENCE, {
        bubbles: true, detail: record.sourceMessageId,
      })))
      part = findPart()
    }
    if (!part) return false
    for (
      let ancestor = part.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
    }
    source.current = part
    setOpen(false)
    return true
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) source.current = null
        setOpen(value)
      }}
      onOpenChangeComplete={(value) => {
        if (!value && source.current?.isConnected)
          source.current.scrollIntoView({ block: "center" })
      }}
    >
      {recordId ? (
        <DialogTrigger
          render={
            label ? (
              <button type="button" className="underline underline-offset-2" />
            ) : (
              <Button size="sm" variant="outline" />
            )
          }
        >
          {label ?? (
            <>
              <BookMarkedIcon /> Project decision · {recordId}
            </>
          )}
        </DialogTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Project memory"
                  />
                }
              />
            }
          >
            <BookMarkedIcon />
          </TooltipTrigger>
          <TooltipContent>Project memory</TooltipContent>
        </Tooltip>
      )}
      <DialogContent
        className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-lg"
        finalFocus={() => source.current ?? true}
      >
        <DialogHeader>
          <DialogTitle>Project memory</DialogTitle>
          {recordId ? (
            <DialogDescription>
              Saved conclusion and original evidence.
            </DialogDescription>
          ) : (
            <DialogDescription>
              Up to {projectDecisionLimit} active research decisions for this
              task.
            </DialogDescription>
          )}
        </DialogHeader>
        {open && (
          <DecisionList
            chatId={chatId}
            recordId={recordId}
            showSource={showSource}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
