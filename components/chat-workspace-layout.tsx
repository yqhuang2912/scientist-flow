"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { PanelImperativeHandle } from "react-resizable-panels"
import { ResearchWorkspace } from "@/components/research-workspace"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import {
  clampWorkspaceWidth,
  shouldCollapseNavigation,
  workspaceLayoutBounds,
  WORKSPACE_DEFAULT_WIDTH,
} from "@/lib/workspace-layout"

interface ChatWorkspaceLayoutProps {
  chatId: string
  workspaceKey?: number
  workspaceOpen: boolean
  onWorkspaceOpenChange: (open: boolean) => void
  onOpenSettings?: () => void
  children: React.ReactNode
}

export function ChatWorkspaceLayout({
  chatId,
  workspaceKey,
  workspaceOpen,
  onWorkspaceOpenChange,
  onOpenSettings,
  children,
}: ChatWorkspaceLayoutProps) {
  const { open: sidebarOpen, setOpen: setSidebarOpen, isMobile } = useSidebar()
  const containerRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<PanelImperativeHandle>(null)
  const preferredWidth = useRef(WORKSPACE_DEFAULT_WIDTH)
  const resizeStartWidth = useRef(0)
  const dragging = useRef(false)
  const collapsedDuringDrag = useRef(false)
  const lastPageWidth = useRef(0)
  const wasOpen = useRef(false)
  const [size, setSize] = useState({ page: 1024, content: 814 })
  const bounds = workspaceLayoutBounds(size.page, size.content)
  const compact = isMobile

  // The page includes the navigation; content size alone is not the 2/3 cap.
  // A manual sidebar expansion is respected until the next resize gesture.
  useEffect(() => {
    const container = containerRef.current
    const page = container?.closest<HTMLElement>(
      '[data-slot="sidebar-wrapper"]'
    )
    if (!container || !page) return
    let frame = 0
    let justOpened = workspaceOpen && !wasOpen.current
    wasOpen.current = workspaceOpen
    const measure = () => {
      const pageWidth = page.clientWidth
      const contentWidth = container.clientWidth
      const shrinking = lastPageWidth.current > pageWidth
      lastPageWidth.current = pageWidth
      setSize((previous) =>
        previous.page === pageWidth && previous.content === contentWidth
          ? previous
          : { page: pageWidth, content: contentWidth }
      )
      if (
        workspaceOpen &&
        sidebarOpen &&
        !isMobile &&
        (justOpened || shrinking) &&
        shouldCollapseNavigation(contentWidth, preferredWidth.current)
      ) {
        setSidebarOpen(false)
      }
      justOpened = false
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(page)
    observer.observe(container)
    schedule()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [workspaceOpen, sidebarOpen, setSidebarOpen, isMobile])

  // Both subtrees remain mounted across panel toggles and the mobile breakpoint.
  // Changing sizes never resets chat effects, file operations, or input drafts.
  useLayoutEffect(() => {
    const container = containerRef.current
    const page = container?.closest<HTMLElement>(
      '[data-slot="sidebar-wrapper"]'
    )
    if (!container || !page) return
    const activeElement = document.activeElement
    if (!workspaceOpen) {
      if (
        activeElement instanceof HTMLElement &&
        activeElement.closest("#workspace-panel")
      ) {
        container
          .querySelector<HTMLButtonElement>("[data-workspace-toggle]")
          ?.focus()
      }
      return
    }
    // Panel constraints are registered in the library's effects. Restore the
    // desktop width after those effects, rather than resizing against the old
    // mobile 100% constraint (which would silently discard the requested size).
    const frame = requestAnimationFrame(() => {
      workspaceRef.current?.resize(
        compact
          ? "100%"
          : clampWorkspaceWidth(
              preferredWidth.current,
              page.clientWidth,
              container.clientWidth
            )
      )
    })
    if (
      compact &&
      !(
        activeElement instanceof HTMLElement &&
        activeElement.closest('[role="dialog"]')
      )
    ) {
      container
        .querySelector<HTMLButtonElement>("[data-workspace-back]")
        ?.focus()
    }
    return () => cancelAnimationFrame(frame)
  }, [workspaceOpen, compact])

  const collapseForResize = useCallback(
    (width: number) => {
      if (
        sidebarOpen &&
        !compact &&
        !collapsedDuringDrag.current &&
        width > resizeStartWidth.current + 1 &&
        shouldCollapseNavigation(containerRef.current?.clientWidth ?? 0, width)
      ) {
        collapsedDuringDrag.current = true
        setSidebarOpen(false)
      }
    },
    [sidebarOpen, compact, setSidebarOpen]
  )

  useEffect(() => {
    // Read pointer intent even at the panel's hard limit, where onResize no
    // longer fires. This lets a leftward drag still release navigation space.
    const move = (event: PointerEvent) => {
      const container = containerRef.current
      if (dragging.current && container) {
        collapseForResize(
          container.getBoundingClientRect().right - event.clientX
        )
      }
    }
    const finish = () => {
      dragging.current = false
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
    window.addEventListener("blur", finish)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      window.removeEventListener("blur", finish)
    }
  }, [collapseForResize])

  return (
    <ResizablePanelGroup
      elementRef={containerRef}
      orientation="horizontal"
      className="min-w-0 flex-1 overflow-hidden"
      disabled={!workspaceOpen || compact}
      resizeTargetMinimumSize={{ fine: 12, coarse: 24 }}
      onLayoutChanged={(_, meta) => {
        if (!meta.isUserInteraction || compact || !workspaceOpen) return
        const width = workspaceRef.current?.getSize().inPixels
        if (width === undefined) return
        preferredWidth.current = width
        collapseForResize(width)
      }}
    >
      <ResizablePanel
        id="chat-panel"
        minSize={!workspaceOpen ? "100%" : compact ? 0 : bounds.chatMin}
        maxSize={compact && workspaceOpen ? 0 : "100%"}
        className="flex h-full min-w-0 flex-col overflow-hidden"
        inert={compact && workspaceOpen}
        aria-hidden={compact && workspaceOpen}
      >
        {children}
      </ResizablePanel>
      <ResizableHandle
        aria-label="调整 Workspace 宽度"
        title="拖动调整 Workspace 宽度；双击恢复默认宽度"
        disabled={!workspaceOpen || compact}
        className={cn(
          "touch-none transition-colors hover:bg-ring/50 focus-visible:bg-ring data-[separator=active]:bg-ring motion-reduce:transition-none",
          (!workspaceOpen || compact) && "hidden"
        )}
        onPointerDownCapture={(event) => {
          if (event.button !== 0) return
          dragging.current = true
          collapsedDuringDrag.current = false
          resizeStartWidth.current =
            workspaceRef.current?.getSize().inPixels ?? 0
        }}
        onKeyDownCapture={(event) => {
          collapsedDuringDrag.current = false
          resizeStartWidth.current =
            workspaceRef.current?.getSize().inPixels ?? 0
          if (event.key === "ArrowLeft" || event.key === "Home") {
            collapseForResize(resizeStartWidth.current + 10)
          }
        }}
        onDoubleClick={() => {
          preferredWidth.current = WORKSPACE_DEFAULT_WIDTH
        }}
      />
      <ResizablePanel
        id="workspace-panel"
        panelRef={workspaceRef}
        defaultSize={WORKSPACE_DEFAULT_WIDTH}
        minSize={!workspaceOpen ? 0 : compact ? "100%" : bounds.min}
        maxSize={!workspaceOpen ? 0 : compact ? "100%" : bounds.max}
        groupResizeBehavior="preserve-pixel-size"
        className="h-full min-w-0 overflow-hidden"
        inert={!workspaceOpen}
        aria-hidden={!workspaceOpen}
      >
        <ResearchWorkspace
          key={workspaceKey}
          chatId={chatId}
          onOpenSettings={onOpenSettings}
          onBack={compact ? () => onWorkspaceOpenChange(false) : undefined}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
