"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import {
  FolderPlusIcon,
  FilePlusIcon,
  GitBranchIcon,
  WorkflowIcon,
  FolderIcon,
  FolderOpenIcon,
  FileIcon,
  RefreshCwIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  SettingsIcon,
  AlertCircleIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  getWorkspaceStatusAction,
  initialiseWorkspaceAction,
  type WorkspaceStatus,
} from "@/actions/workspace"

interface FsEntry {
  name: string
  isDir: boolean
  relPath: string
}

interface TreeNode {
  entry: FsEntry
  children: TreeNode[] | null // null = not loaded yet
  expanded: boolean
  loading: boolean
  error: string | null
  truncated: boolean
}

interface ResearchWorkspaceProps {
  chatId: string
  onOpenSettings?: () => void
}

// ─── Tree node helpers ────────────────────────────────────────────────────────

async function fetchChildren(
  chatId: string,
  relPath: string
): Promise<{ entries: FsEntry[]; truncated: boolean }> {
  const url = `/api/workspace/${encodeURIComponent(chatId)}/tree?path=${encodeURIComponent(relPath)}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<{ entries: FsEntry[]; truncated: boolean }>
}

function buildRootNodes(entries: FsEntry[]): TreeNode[] {
  return entries.map((e) => ({
    entry: e,
    children: null,
    expanded: false,
    loading: false,
    error: null,
    truncated: false,
  }))
}

// Deep-clone unused — removed

function updateNode(
  nodes: TreeNode[],
  relPath: string,
  updater: (n: TreeNode) => TreeNode
): TreeNode[] {
  return nodes.map((n) => {
    if (n.entry.relPath === relPath) {
      return updater({ ...n })
    }
    if (n.children) {
      return { ...n, children: updateNode(n.children, relPath, updater) }
    }
    return n
  })
}

// ─── FileTree component ───────────────────────────────────────────────────────

function FileTree({
  nodes,
  chatId,
  selectedRel,
  onSelect,
  onToggle,
  depth,
}: {
  nodes: TreeNode[]
  chatId: string
  selectedRel: string | null
  onSelect: (relPath: string) => void
  onToggle: (relPath: string) => void
  depth: number
}) {
  if (nodes.length === 0) {
    return (
      <p
        className="py-1 text-[11px] text-muted-foreground"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        Empty
      </p>
    )
  }

  return (
    <ul role="tree" className="min-w-0">
      {nodes.map((node) => (
        <li key={node.entry.relPath} role="treeitem" aria-expanded={node.expanded}>
          <button
            type="button"
            className={cn(
              "flex w-full min-w-0 items-center gap-1 rounded py-0.5 pr-2 text-left text-xs hover:bg-accent",
              selectedRel === node.entry.relPath &&
                "bg-accent text-accent-foreground"
            )}
            style={{ paddingLeft: depth * 12 + 4 }}
            onClick={() => {
              if (node.entry.isDir) {
                onToggle(node.entry.relPath)
              } else {
                onSelect(node.entry.relPath)
              }
            }}
          >
            {node.entry.isDir ? (
              <>
                <span className="shrink-0 text-muted-foreground">
                  {node.loading ? (
                    <Spinner className="size-3" />
                  ) : node.expanded ? (
                    <ChevronDownIcon className="size-3" />
                  ) : (
                    <ChevronRightIcon className="size-3" />
                  )}
                </span>
                {node.expanded ? (
                  <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </>
            ) : (
              <>
                <span className="size-3 shrink-0" />
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </>
            )}
            <span className="min-w-0 truncate">{node.entry.name}</span>
          </button>

          {node.error && (
            <p
              className="flex items-center gap-1 py-0.5 text-[11px] text-destructive"
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              <AlertCircleIcon className="size-3 shrink-0" />
              {node.error}
            </p>
          )}

          {node.expanded && node.children && (
            <FileTree
              nodes={node.children}
              chatId={chatId}
              selectedRel={selectedRel}
              onSelect={onSelect}
              onToggle={onToggle}
              depth={depth + 1}
            />
          )}

          {node.expanded && node.truncated && (
            <p
              className="py-0.5 text-[11px] text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              Limited to 200 items
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

// Outer shell — just passes key so inner remounts cleanly on chatId change
export function ResearchWorkspace({
  chatId,
  onOpenSettings,
}: ResearchWorkspaceProps) {
  return (
    <ResearchWorkspaceInner
      key={chatId}
      chatId={chatId}
      onOpenSettings={onOpenSettings}
    />
  )
}

function ResearchWorkspaceInner({
  chatId,
  onOpenSettings,
}: ResearchWorkspaceProps) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [initPending, startInitTransition] = useTransition()
  const [initError, setInitError] = useState<string | null>(null)

  const [tree, setTree] = useState<TreeNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [selectedRel, setSelectedRel] = useState<string | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    const s = await getWorkspaceStatusAction(chatId)
    if (!mountedRef.current) return
    setStatus(s)
    setStatusLoading(false)
  }, [chatId])

  const loadTree = useCallback(async () => {
    setTreeLoading(true)
    setTreeError(null)
    try {
      const { entries, truncated } = await fetchChildren(chatId, "")
      if (!mountedRef.current) return
      const nodes = buildRootNodes(entries)
      setTree(nodes)
      if (truncated) setTreeError("Root contains more than 200 items.")
    } catch (err) {
      if (!mountedRef.current) return
      setTreeError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mountedRef.current) setTreeLoading(false)
    }
  }, [chatId])

  // On mount: load status. Inner component remounts on chatId change (key prop).
  useEffect(() => {
    // loadStatus is async — setState runs only inside its .then(), not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus()
  }, [loadStatus])

  // Load tree when status becomes ready
  useEffect(() => {
    if (status?.state === "ready") {
      // loadTree is async — setState runs only inside its try/catch, not synchronously
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadTree()
    }
  }, [status, loadTree])

  function handleToggle(relPath: string) {
    const node = findNode(tree, relPath)
    if (!node) return

    if (node.expanded) {
      setTree((prev) =>
        updateNode(prev, relPath, (n) => ({ ...n, expanded: false }))
      )
      return
    }

    if (node.children !== null) {
      setTree((prev) =>
        updateNode(prev, relPath, (n) => ({ ...n, expanded: true }))
      )
      return
    }

    // Load children
    setTree((prev) =>
      updateNode(prev, relPath, (n) => ({ ...n, loading: true, error: null }))
    )
    fetchChildren(chatId, relPath)
      .then(({ entries, truncated }) => {
        if (!mountedRef.current) return
        setTree((prev) =>
          updateNode(prev, relPath, (n) => ({
            ...n,
            loading: false,
            expanded: true,
            children: buildRootNodes(entries),
            truncated,
          }))
        )
      })
      .catch((err) => {
        if (!mountedRef.current) return
        setTree((prev) =>
          updateNode(prev, relPath, (n) => ({
            ...n,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          }))
        )
      })
  }

  function handleInitialise() {
    setInitError(null)
    startInitTransition(async () => {
      const result = await initialiseWorkspaceAction(chatId)
      if (!result.success) {
        setInitError(result.error)
        return
      }
      await loadStatus()
    })
  }

  function handleRefresh() {
    setTree([])
    setSelectedRel(null)
    loadTree()
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const isReady = status?.state === "ready"

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Toolbar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-medium text-foreground">Workspace</span>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh file tree"
                  disabled={!isReady || treeLoading}
                  onClick={handleRefresh}
                />
              }
            >
              <RefreshCwIcon className={cn("size-4", treeLoading && "animate-spin")} />
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New folder (not available)"
                  disabled
                />
              }
            >
              <FolderPlusIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>New folder — not yet available</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New file (not available)"
                  disabled
                />
              }
            >
              <FilePlusIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>New file — not yet available</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Git (not available)"
                  disabled
                />
              }
            >
              <GitBranchIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Git — not yet available</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Research flow (not available)"
                  disabled
                />
              }
            >
              <WorkflowIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Research flow — not yet available</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        {statusLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            Loading workspace…
          </div>
        )}

        {!statusLoading && status?.state === "no-config" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              No workspace root directory configured.
            </p>
            {onOpenSettings && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit gap-1.5"
                onClick={onOpenSettings}
              >
                <SettingsIcon className="size-3.5" />
                Set workspace directory
              </Button>
            )}
          </div>
        )}

        {!statusLoading && status?.state === "not-initialised" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Workspace not yet initialised for this task.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Root: <span className="font-mono">{status.rootDir}</span>
            </p>
            {initError && (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircleIcon className="size-3.5 shrink-0" />
                {initError}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={initPending}
              onClick={handleInitialise}
            >
              {initPending && <Spinner className="size-3" data-icon="inline-start" />}
              Initialise workspace
            </Button>
          </div>
        )}

        {!statusLoading && status?.state === "error" && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircleIcon className="size-3.5 shrink-0" />
              {status.message}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={loadStatus}
            >
              Retry
            </Button>
          </div>
        )}

        {!statusLoading && status?.state === "ready" && (
          <div className="flex min-h-0 flex-col gap-1">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {chatId}
            </p>
            {treeLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                Loading…
              </div>
            )}
            {treeError && (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircleIcon className="size-3.5 shrink-0" />
                  {treeError}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={handleRefresh}
                >
                  Retry
                </Button>
              </div>
            )}
            {!treeLoading && !treeError && (
              <FileTree
                nodes={tree}
                chatId={chatId}
                selectedRel={selectedRel}
                onSelect={setSelectedRel}
                onToggle={handleToggle}
                depth={0}
              />
            )}
            {selectedRel && (
              <div className="mt-2 rounded border border-border bg-muted/40 p-2">
                <p className="text-[11px] text-muted-foreground">Selected</p>
                <p className="break-all font-mono text-xs">{selectedRel}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tree search helper ───────────────────────────────────────────────────────

function findNode(nodes: TreeNode[], relPath: string): TreeNode | null {
  for (const n of nodes) {
    if (n.entry.relPath === relPath) return n
    if (n.children) {
      const found = findNode(n.children, relPath)
      if (found) return found
    }
  }
  return null
}
