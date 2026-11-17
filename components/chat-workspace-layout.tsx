"use client"

import { useCallback, useRef, useState } from "react"
import { ResearchWorkspace } from "@/components/research-workspace"

interface ChatWorkspaceLayoutProps {
  chatId: string
  workspaceKey?: number
  workspaceOpen: boolean
  onWorkspaceOpenChange: (open: boolean) => void
  onOpenSettings?: () => void
  children: React.ReactNode
}

const WORKSPACE_MIN_PX = 220
const WORKSPACE_DEFAULT_PX = 400
const WORKSPACE_MAX_RATIO = 0.6

export function ChatWorkspaceLayout({
  chatId,
  workspaceKey,
  workspaceOpen,
  onWorkspaceOpenChange,
  onOpenSettings,
  children,
}: ChatWorkspaceLayoutProps) {
  const [workspaceWidth, setWorkspaceWidth] = useState(WORKSPACE_DEFAULT_PX)
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return

      const startX = event.clientX
      const startWidth = workspaceWidth

      const prevCursor = document.body.style.cursor
      const prevSelect = document.body.style.userSelect
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"

      function onMove(e: PointerEvent) {
        if (!containerRef.current) return
        const containerWidth = containerRef.current.offsetWidth
        const maxWidth = Math.floor(containerWidth * WORKSPACE_MAX_RATIO)
        const delta = startX - e.clientX
        const next = Math.min(
          Math.max(startWidth + delta, WORKSPACE_MIN_PX),
          Math.max(maxWidth, WORKSPACE_MIN_PX)
        )
        setWorkspaceWidth(next)
        if (next <= WORKSPACE_MIN_PX + 10 && delta > 50) {
          onWorkspaceOpenChange(false)
        }
      }

      function onUp() {
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevSelect
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onUp)
    },
    [workspaceWidth, onWorkspaceOpenChange]
  )

  // The chat subtree (children) is always rendered at the same DOM position
  // so opening/closing the workspace panel never unmounts or remounts it.
  // The workspace column is hidden via CSS (width: 0 + overflow hidden) when
  // closed, keeping the chat identity and input draft stable.
  return (
    <div
      ref={containerRef}
      className="flex h-full min-w-0 flex-1 flex-row overflow-hidden"
    >
      {/* Chat column — always mounted, takes remaining space */}
      <div className="flex min-w-80 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {/* Drag handle — only interactive when workspace is open */}
      {workspaceOpen && (
        <div
          role="separator"
          aria-label="Resize workspace panel"
          aria-orientation="vertical"
          onPointerDown={handlePointerDown}
          className="relative z-10 w-px cursor-col-resize bg-border transition-colors hover:bg-ring/40 after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2"
        />
      )}

      {/* Workspace column — zero-width when closed, no unmount */}
      <div
        className="flex shrink-0 flex-col overflow-hidden border-l border-border transition-[width] duration-200 ease-linear"
        style={{ width: workspaceOpen ? workspaceWidth : 0, borderLeftWidth: workspaceOpen ? 1 : 0 }}
        aria-hidden={!workspaceOpen}
      >
        <ResearchWorkspace key={workspaceKey} chatId={chatId} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  )
}
