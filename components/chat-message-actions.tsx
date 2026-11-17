"use client"

import { useEffect, useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MessageFooter } from "@/components/ui/message"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "@/components/ui/toast"

export function ChatMessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  if (!text) return null
  const label = copied ? "Copied" : "Copy message"
  return (
    <MessageFooter className="px-0">
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
                  toast.add({ type: "error", title: "Could not copy message" })
                }
              }}
            />
          }
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite">
        {copied ? "Message copied" : ""}
      </span>
    </MessageFooter>
  )
}
