"use client"

import { useEffect, useState } from "react"
import {
  BookmarkPlusIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RotateCcwIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { MessageFooter } from "@/components/ui/message"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "@/components/ui/toast"
import type { ReplyVersions } from "@/lib/chat-revision"

export function ChatMessageActions({
  text,
  remember,
  edit,
  retry,
  versions,
  choose,
  disabled,
}: {
  text: string
  remember?: { label: string; open: () => void }
  edit?: () => void
  retry?: () => void
  versions?: ReplyVersions
  choose?: (id: string) => void
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const hasVersions = versions && versions.replies.length > 1 && choose
  if (!text && !edit && !retry && !hasVersions) return null
  const label = copied ? "Copied" : "Copy message"
  return (
    <MessageFooter
      className={
        hasVersions
          ? "px-0"
          : "px-0 opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100 motion-safe:transition-opacity [@media(hover:none)]:opacity-100"
      }
    >
      {text && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text)
                    setCopied(true)
                  } catch {
                    toast.add({
                      type: "error",
                      title: "Could not copy message",
                    })
                  }
                }}
              />
            }
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
      {[
        { label: "Edit message", action: edit, Icon: PencilIcon },
        { label: "Retry reply", action: retry, Icon: RotateCcwIcon },
      ].map(
        ({ label, action, Icon }) =>
          action && (
            <Tooltip key={label}>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={label}
                    disabled={disabled}
                    onClick={action}
                  />
                }
              >
                <Icon />
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          )
      )}
      {hasVersions && (
        <div
          role="group"
          aria-label="Reply versions"
          className="inline-flex items-center"
        >
          <Button
            type="button"
            size="icon-compact"
            variant="ghost"
            aria-label="Previous reply version"
            disabled={disabled || versions.selected === 0}
            onClick={() => choose(versions.replies[versions.selected - 1].id)}
          >
            <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <span
            aria-live="polite"
            aria-atomic="true"
            className="px-0.5 text-xs tabular-nums"
          >
            {versions.selected + 1}/{versions.replies.length}
          </span>
          <Button
            type="button"
            size="icon-compact"
            variant="ghost"
            aria-label="Next reply version"
            disabled={
              disabled || versions.selected === versions.replies.length - 1
            }
            onClick={() => choose(versions.replies[versions.selected + 1].id)}
          >
            <ChevronRightIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      )}
      {remember && text.trim() && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={remember.label}
                onClick={remember.open}
              />
            }
          >
            <BookmarkPlusIcon />
          </TooltipTrigger>
          <TooltipContent>{remember.label}</TooltipContent>
        </Tooltip>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? "Message copied" : ""}
      </span>
    </MessageFooter>
  )
}
