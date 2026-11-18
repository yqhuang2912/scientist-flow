"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import {
  FolderPlusIcon,
  FolderOpenIcon,
  FilePlusIcon,
  GitBranchIcon,
  WorkflowIcon,
  RefreshCwIcon,
  SettingsIcon,
  AlertCircleIcon,
  ArrowLeftIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { toast } from "@/components/ui/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  WorkspaceFileTree,
  type WorkspaceEntryAction,
} from "@/components/workspace-file-tree"
import {
  CreateWorkspaceEntryDialog,
  DeleteWorkspaceFolderDialog,
  DeleteWorkspaceFileDialog,
} from "@/components/workspace-folder-dialogs"
import { cn } from "@/lib/utils"
import { useWorkspaceDocument } from "@/components/workspace-document-provider"
import type { DocumentTarget } from "@/lib/workspace-document"
import {
  getWorkspaceStatusAction,
  initialiseWorkspaceAction,
  inspectWorkspaceDirectoryForDeletionAction,
  inspectWorkspaceFileForDeletionAction,
  type WorkspaceStatus,
} from "@/actions/workspace"
import {
  findWorkspaceNode,
  mergeWorkspaceChildren,
  removeWorkspaceSubtree,
  selectionAfterDirectoryDeletion,
  updateWorkspaceNode,
  WorkspaceDirectoryReads,
  type WorkspaceTreeNode,
} from "@/lib/workspace-tree"
import {
  isWorkspaceSubtree,
  workspaceParentPath,
  type DirectoryDeletionInspection,
  type FileDeletionInspection,
  type WorkspaceEntry,
} from "@/lib/workspace-validation"

interface ResearchWorkspaceProps {
  chatId: string
  onOpenSettings?: () => void
  onBack?: () => void
}
type Operation = { chatId: string; relativePath: string } & (
  | { kind: "create" | "create-file" }
  | { kind: "inspect" | "inspect-file" }
  | { kind: "delete"; inspection: DirectoryDeletionInspection }
  | { kind: "delete-file"; inspection: FileDeletionInspection }
)

async function fetchChildren(
  chatId: string,
  relative: string
): Promise<{ entries: WorkspaceEntry[]; truncated: boolean }> {
  const response = await fetch(
    `/api/workspace/${encodeURIComponent(chatId)}/tree?path=${encodeURIComponent(relative)}`,
    { cache: "no-store" }
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${response.status}`)
  }
  return response.json()
}

function loadedDirectories(nodes: WorkspaceTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.children
      ? [node.entry.relPath, ...loadedDirectories(node.children)]
      : []
  )
}

function clearRelatedLoading(
  nodes: WorkspaceTreeNode[],
  relative: string
): WorkspaceTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    loading:
      isWorkspaceSubtree(relative, node.entry.relPath) ||
      isWorkspaceSubtree(node.entry.relPath, relative)
        ? false
        : node.loading,
    children: node.children
      ? clearRelatedLoading(node.children, relative)
      : null,
  }))
}

// Only this workspace remounts on a chat change; the chat subtree stays intact.
export function ResearchWorkspace(props: ResearchWorkspaceProps) {
  return <ResearchWorkspaceInner key={props.chatId} {...props} />
}

function ResearchWorkspaceInner({
  chatId,
  onOpenSettings,
  onBack,
}: ResearchWorkspaceProps) {
  const workbench = useWorkspaceDocument()
  const deletionTarget = useRef<DocumentTarget | null>(null)
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [initPending, startInitTransition] = useTransition()
  const [initError, setInitError] = useState<string | null>(null)
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [rootTruncated, setRootTruncated] = useState(false)
  const [rootLoaded, setRootLoaded] = useState(false)
  const [selectedRel, setSelectedRel] = useState<string | null>(null)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [mutationPending, setMutationPending] = useState(false)
  const noticeToast = useRef<string | null>(null)
  const mounted = useRef(true)
  const reads = useRef(new WorkspaceDirectoryReads())
  const operationLocked = useRef(false)
  const mutationPath = useRef<string | null>(null)
  const locatePath = useRef<string | null>(null)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (deletionTarget.current && !mutationPath.current)
        workbench.session.finishDeletion(deletionTarget.current, false)
      if (noticeToast.current) toast.close(noticeToast.current)
    }
  }, [workbench])

  function showNotice(
    title: string,
    description?: string,
    type: "success" | "info" | "error" = "success"
  ) {
    if (!mounted.current) return
    if (noticeToast.current) toast.close(noticeToast.current)
    noticeToast.current = toast.add({
      title,
      description,
      type,
      timeout: type === "error" ? 5000 : 3000,
    })
  }

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const next = await getWorkspaceStatusAction(chatId)
      if (mounted.current) setStatus(next)
    } catch {
      if (mounted.current)
        setStatus({ state: "error", message: "无法读取工作区状态，请重试。" })
    } finally {
      if (mounted.current) setStatusLoading(false)
    }
  }, [chatId])

  const refreshBranch = useCallback(
    async (relative: string, created?: WorkspaceEntry) => {
      if (!mounted.current) return
      const version = reads.current.begin(relative)
      const current = () =>
        mounted.current && reads.current.current(relative, version)
      if (!relative) {
        setTreeLoading(true)
        setTreeError(null)
      } else
        setTree((previous) =>
          updateWorkspaceNode(previous, relative, (node) => ({
            ...node,
            loading: true,
            error: null,
          }))
        )
      try {
        const result = await fetchChildren(chatId, relative)
        if (!current()) return
        // Keep the just-created directory visible even beyond the listing cap.
        const entries =
          created &&
          result.truncated &&
          !result.entries.some((entry) => entry.relPath === created.relPath)
            ? [...result.entries, created]
            : result.entries
        if (!relative) {
          setTree((previous) => mergeWorkspaceChildren(previous, entries))
          setRootTruncated(result.truncated)
          setRootLoaded(true)
        } else {
          setTree((previous) =>
            updateWorkspaceNode(previous, relative, (node) => ({
              ...node,
              loading: false,
              error: null,
              children: mergeWorkspaceChildren(node.children ?? [], entries),
              truncated: result.truncated,
              expanded: created ? true : node.expanded,
            }))
          )
        }
        if (created) {
          setSelectedRel(created.relPath)
          locatePath.current = created.relPath
        }
      } catch (error) {
        if (!current()) return
        const message =
          error instanceof Error ? error.message : "无法读取文件夹。"
        if (!relative) {
          setTreeError(message)
          setRootLoaded(false)
        } else
          setTree((previous) =>
            updateWorkspaceNode(previous, relative, (node) => ({
              ...node,
              loading: false,
              error: message,
            }))
          )
      } finally {
        if (current() && !relative) setTreeLoading(false)
      }
    },
    [chatId]
  )

  useEffect(() => {
    // Initial status is an asynchronous external read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus()
  }, [loadStatus])
  useEffect(() => {
    if (status?.state === "ready") {
      void refreshBranch("")
    }
  }, [status, refreshBranch])
  useEffect(() => {
    if (!locatePath.current || operation) return
    const element = container.current?.querySelector<HTMLButtonElement>(
      `[data-workspace-path="${CSS.escape(locatePath.current)}"]`
    )
    if (!element) return
    element.scrollIntoView({ block: "nearest" })
    element.focus({ preventScroll: true })
    locatePath.current = null
  }, [tree, operation])

  function invalidate(relative: string) {
    reads.current.invalidate(relative)
    setTreeLoading(false)
    setTree((previous) => clearRelatedLoading(previous, relative))
  }

  function handleToggle(relative: string) {
    const node = findWorkspaceNode(tree, relative)
    if (!node) return
    const expanded = !node.expanded
    setTree((previous) =>
      updateWorkspaceNode(previous, relative, (value) => ({
        ...value,
        expanded,
      }))
    )
    if (expanded && !node.loading && (node.children === null || node.error))
      void refreshBranch(relative)
  }

  function handleRefresh() {
    if (mutationPending) return
    void workbench.session.checkExists(chatId)
    const paths = loadedDirectories(tree)
    void refreshBranch("")
    for (const relative of paths) void refreshBranch(relative)
  }

  function handleInitialise() {
    setInitError(null)
    startInitTransition(async () => {
      try {
        const result = await initialiseWorkspaceAction(chatId)
        if (!mounted.current) return
        if (!result.success) {
          setInitError(result.error)
          return
        }
        await loadStatus()
      } catch {
        if (mounted.current) setInitError("无法初始化工作区，请重试。")
      }
    })
  }

  function closeOperation() {
    if (deletionTarget.current)
      workbench.session.finishDeletion(deletionTarget.current, false)
    deletionTarget.current = null
    operationLocked.current = false
    setOperation(null)
  }
  function startMutation(relative: string) {
    mutationPath.current = relative
    setMutationPending(true)
    invalidate(relative)
  }
  function finishMutation() {
    if (!mounted.current) return
    // Any read started before the completed mutation must not restore old nodes.
    if (mutationPath.current) invalidate(mutationPath.current)
    mutationPath.current = null
    setMutationPending(false)
  }

  async function handleCreated(target: Operation, entry: WorkspaceEntry) {
    if (!mounted.current) return
    finishMutation()
    closeOperation()
    showNotice(
      entry.isDir ? "Folder created" : "File created",
      `${entry.relPath}${entry.isDir ? "/" : ""}`
    )
    setSelectedRel(entry.relPath)
    if (target.relativePath)
      setTree((previous) =>
        updateWorkspaceNode(previous, target.relativePath, (node) => ({
          ...node,
          expanded: true,
        }))
      )
    await refreshBranch(target.relativePath, entry)
  }

  async function handleDeleted(target: Operation, alreadyGone: boolean) {
    workbench.session.finishDeletion(target, true)
    if (!mounted.current) return
    finishMutation()
    invalidate(target.relativePath)
    closeOperation()
    setTree((previous) => removeWorkspaceSubtree(previous, target.relativePath))
    setSelectedRel((previous) =>
      selectionAfterDirectoryDeletion(previous, target.relativePath)
    )
    showNotice(
      `${target.kind.endsWith("-file") ? "文件" : "文件夹"}${alreadyGone ? "已不存在" : "已删除"}`,
      `${target.relativePath}${target.kind.endsWith("-file") ? "" : "/"}`,
      alreadyGone ? "info" : "success"
    )
    await refreshBranch(workspaceParentPath(target.relativePath))
  }

  async function reconcileFailedDeletion(target: Operation) {
    await workbench.session.checkExists(target.chatId)
    if (!mounted.current) return
    invalidate(target.relativePath)
    const node = findWorkspaceNode(tree, target.relativePath)
    const paths = node?.entry.isDir
      ? [target.relativePath, ...loadedDirectories(node.children ?? [])]
      : []
    await refreshBranch(workspaceParentPath(target.relativePath))
    if (target.kind === "delete-file") return
    await Promise.all(paths.map((relative) => refreshBranch(relative)))
    if (!mounted.current) return
    setSelectedRel((previous) =>
      selectionAfterDirectoryDeletion(previous, target.relativePath)
    )
  }

  async function handleEntryAction(
    kind: WorkspaceEntryAction,
    relativePath: string
  ) {
    if (operationLocked.current || mutationPending || status?.state !== "ready")
      return
    if (kind === "open") {
      const node = findWorkspaceNode(tree, relativePath)
      if (node?.entry.isFile) void workbench.open({ chatId, relativePath })
      return
    }
    operationLocked.current = true
    if (noticeToast.current) toast.close(noticeToast.current)
    if (kind === "create" || kind === "create-file") {
      setOperation({ kind, chatId, relativePath })
      return
    }
    deletionTarget.current = { chatId, relativePath }
    const allowed = await workbench.session.prepareDeletion({
      chatId,
      relativePath,
    })
    if (!mounted.current || !allowed) {
      workbench.session.finishDeletion({ chatId, relativePath }, false)
      if (mounted.current) closeOperation()
      return
    }
    const target: Operation = {
      kind: kind === "delete" ? "inspect" : "inspect-file",
      chatId,
      relativePath,
    }
    setOperation(target)
    const label = kind === "delete-file" ? "文件" : "文件夹"
    try {
      const result =
        kind === "delete-file"
          ? {
              kind: "delete-file" as const,
              ...(await inspectWorkspaceFileForDeletionAction(
                target.chatId,
                target.relativePath
              )),
            }
          : {
              kind: "delete" as const,
              ...(await inspectWorkspaceDirectoryForDeletionAction(
                target.chatId,
                target.relativePath
              )),
            }
      if (!mounted.current) return
      if (result.success) {
        if (result.kind === "delete")
          setOperation({
            ...target,
            kind: "delete",
            inspection: result.inspection,
          })
        else
          setOperation({
            ...target,
            kind: "delete-file",
            inspection: result.inspection,
          })
      } else if (result.code === "NOT_FOUND") await handleDeleted(target, true)
      else {
        closeOperation()
        showNotice(`无法读取${label}状态`, result.error, "error")
        await refreshBranch(workspaceParentPath(relativePath))
      }
    } catch {
      if (mounted.current) {
        closeOperation()
        showNotice(`无法读取${label}状态`, "请重试。", "error")
      }
    }
  }

  const isReady = status?.state === "ready"
  const unavailableReason = statusLoading
    ? "Loading workspace status"
    : status?.state === "no-config"
      ? "No workspace directory configured"
      : status?.state === "not-initialised"
        ? "This task's workspace has not been initialized"
        : status?.state === "error"
          ? "Workspace is inaccessible"
          : treeError
            ? "Workspace is inaccessible"
            : !rootLoaded
              ? "Loading the task root directory"
              : mutationPending || operation
                ? "Finish the current file operation first"
                : null

  return (
    <div ref={container} className="flex h-full min-w-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          {onBack && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Back to chat"
                    data-workspace-back
                    onClick={onBack}
                  />
                }
              >
                <ArrowLeftIcon />
              </TooltipTrigger>
              <TooltipContent>Back to chat</TooltipContent>
            </Tooltip>
          )}
          <div className="flex min-w-0 flex-col gap-0">
            <span className="text-sm leading-5 font-medium text-foreground">
              Workspace
            </span>
            {!statusLoading && isReady && (
              <p
                className="truncate text-[11px] leading-tight text-muted-foreground"
                title={chatId}
              >
                {chatId}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh file tree"
                  disabled={!isReady || treeLoading || mutationPending}
                  onClick={handleRefresh}
                />
              }
            >
              <RefreshCwIcon
                className={cn("size-4", treeLoading && "animate-spin")}
              />
            </TooltipTrigger>
            <TooltipContent>Refresh file tree</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={unavailableReason ? 0 : undefined}
                  aria-label={
                    unavailableReason
                      ? `New folder in task root: ${unavailableReason}`
                      : undefined
                  }
                  className="inline-flex"
                />
              }
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="New folder in task root"
                disabled={!!unavailableReason}
                onClick={() => void handleEntryAction("create", "")}
              >
                <FolderPlusIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              New folder in task root
              {unavailableReason && ` (${unavailableReason})`}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="inline-flex"
                  tabIndex={unavailableReason ? 0 : undefined}
                  aria-label={
                    unavailableReason
                      ? `New file in task root: ${unavailableReason}`
                      : undefined
                  }
                />
              }
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="New file in task root"
                disabled={!!unavailableReason}
                onClick={() => void handleEntryAction("create-file", "")}
              >
                <FilePlusIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              New file in task root
              {unavailableReason && ` (${unavailableReason})`}
            </TooltipContent>
          </Tooltip>
          {[
            { icon: GitBranchIcon, label: "Git" },
            { icon: WorkflowIcon, label: "Research flow" },
          ].map(({ icon: Icon, label }) => (
            <Tooltip key={label}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${label} (not available)`}
                    disabled
                  />
                }
              >
                <Icon />
              </TooltipTrigger>
              <TooltipContent>{label} — not yet available</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
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
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={onOpenSettings}
              >
                <SettingsIcon data-icon="inline-start" />
                Set workspace directory
              </Button>
            )}
          </div>
        )}
        {!statusLoading && status?.state === "not-initialised" && (
          <Empty className="px-4 py-8" aria-busy={initPending}>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpenIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No workspace yet</EmptyTitle>
              <EmptyDescription>
                Create a workspace for this task&apos;s files.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                size="sm"
                disabled={initPending}
                onClick={handleInitialise}
              >
                {initPending && <Spinner data-icon="inline-start" />}
                {initPending ? "Initialising…" : "Initialise workspace"}
              </Button>
              <p className="max-w-full text-[11px] leading-relaxed [overflow-wrap:anywhere] text-muted-foreground">
                Root: {status.rootDir}
              </p>
              {initError && (
                <p
                  role="alert"
                  className="text-xs [overflow-wrap:anywhere] text-destructive"
                >
                  {initError}
                </p>
              )}
            </EmptyContent>
          </Empty>
        )}
        {!statusLoading && status?.state === "error" && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-xs text-destructive">
              {status.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void loadStatus()}
            >
              Retry
            </Button>
          </div>
        )}
        {!statusLoading && isReady && (
          <div className="flex min-h-0 flex-col gap-1">
            {(operation?.kind === "inspect" ||
              operation?.kind === "inspect-file") && (
              <p
                role="status"
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <Spinner className="size-3" />
                {operation.kind === "inspect-file"
                  ? "正在读取文件状态…"
                  : "正在读取文件夹状态…"}
              </p>
            )}
            {treeLoading && (
              <div
                role="status"
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <Spinner className="size-3" />
                Loading…
              </div>
            )}
            {treeError && (
              <div className="flex flex-col gap-2">
                <p
                  role="alert"
                  className="flex items-center gap-1 text-xs text-destructive"
                >
                  <AlertCircleIcon className="size-3.5 shrink-0" />
                  {treeError}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={handleRefresh}
                >
                  Retry
                </Button>
              </div>
            )}
            <WorkspaceFileTree
              nodes={tree}
              selectedRel={selectedRel}
              onSelect={setSelectedRel}
              onToggle={handleToggle}
              onRetry={(relative) => void refreshBranch(relative)}
              onEntryAction={(kind, relative) =>
                void handleEntryAction(kind, relative)
              }
              actionsDisabled={
                mutationPending || !!operation || !!treeError || !rootLoaded
              }
            />
            {rootTruncated && (
              <p className="py-1 text-[11px] text-muted-foreground">
                Showing the first 200 items and newly created items.
              </p>
            )}
          </div>
        )}
      </div>
      {(operation?.kind === "create" || operation?.kind === "create-file") && (
        <CreateWorkspaceEntryDialog
          kind={operation.kind === "create-file" ? "file" : "directory"}
          target={operation}
          onClose={closeOperation}
          onStart={startMutation}
          onCreated={(entry) => void handleCreated(operation, entry)}
          onSettled={finishMutation}
        />
      )}
      {operation?.kind === "delete-file" && (
        <DeleteWorkspaceFileDialog
          target={operation}
          initialInspection={operation.inspection}
          onClose={closeOperation}
          onStart={startMutation}
          onDeleted={(gone) => void handleDeleted(operation, gone)}
          onReconcile={() => reconcileFailedDeletion(operation)}
          onSettled={finishMutation}
        />
      )}
      {operation?.kind === "delete" && (
        <DeleteWorkspaceFolderDialog
          target={operation}
          initialInspection={operation.inspection}
          onClose={closeOperation}
          onStart={startMutation}
          onDeleted={(gone) => void handleDeleted(operation, gone)}
          onReconcile={() => reconcileFailedDeletion(operation)}
          onSettled={finishMutation}
        />
      )}
    </div>
  )
}
