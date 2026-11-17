"use client"

import { useState } from "react"
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { type WorkspaceTreeNode } from "@/lib/workspace-tree"

export type WorkspaceEntryAction =
  "create" | "delete" | "create-file" | "delete-file"
type TreeProps = {
  nodes: WorkspaceTreeNode[]
  selectedRel: string | null
  onSelect: (relative: string) => void
  onToggle: (relative: string) => void
  onRetry: (relative: string) => void
  onEntryAction: (action: WorkspaceEntryAction, relative: string) => void
  actionsDisabled: boolean
  depth?: number
}

// Both menu surfaces share the same items and row-bound callback.
function EntryMenuItems({
  context = false,
  isDir,
  disabled,
  onAction,
}: {
  context?: boolean
  isDir: boolean
  disabled: boolean
  onAction: (action: WorkspaceEntryAction) => void
}) {
  const Item = context ? ContextMenuItem : DropdownMenuItem
  const Group = context ? ContextMenuGroup : DropdownMenuGroup
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator
  return (
    <Group>
      {isDir && (
        <>
          <Item
            className="gap-2 px-2 py-2"
            disabled={disabled}
            onClick={() => onAction("create-file")}
          >
            <FilePlusIcon />
            新建文件
          </Item>
          <Item
            className="gap-2 px-2 py-2"
            disabled={disabled}
            onClick={() => onAction("create")}
          >
            <FolderPlusIcon />
            新建子文件夹
          </Item>
          <Separator />
        </>
      )}
      <Item
        disabled={disabled}
        variant="destructive"
        className="gap-2 px-2 py-2"
        onClick={() => onAction(isDir ? "delete" : "delete-file")}
      >
        <Trash2Icon />
        {isDir ? "删除文件夹" : "删除文件"}
      </Item>
    </Group>
  )
}

function FileTreeRow({
  node,
  depth,
  selected,
  disabled,
  onSelect,
  onToggle,
  onAction,
}: {
  node: WorkspaceTreeNode
  depth: number
  selected: boolean
  disabled: boolean
  onSelect: () => void
  onToggle: () => void
  onAction: (action: WorkspaceEntryAction) => void
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const hasActions = node.entry.isDir || node.entry.isFile === true
  const actionLabel = node.entry.isDir ? "文件夹操作" : "文件操作"
  const row = (
    <div
      className={cn(
        "group/row flex min-w-0 items-center rounded ring-ring ring-inset focus-within:bg-accent hover:bg-accent has-[[data-workspace-path]:focus-visible]:ring-2",
        (selected || dropdownOpen || contextOpen) &&
          "bg-accent text-accent-foreground"
      )}
    >
      <button
        type="button"
        data-workspace-path={node.entry.relPath}
        aria-label={node.entry.name}
        aria-expanded={node.entry.isDir ? node.expanded : undefined}
        className="flex min-w-0 flex-1 items-center gap-1 rounded py-1 pr-1 text-left text-xs outline-none"
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => {
          onSelect()
          if (node.entry.isDir) onToggle()
        }}
      >
        <span className="size-3 shrink-0 text-muted-foreground">
          {node.entry.isDir &&
            (node.loading ? (
              <Spinner className="size-3" />
            ) : node.expanded ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            ))}
        </span>
        {node.entry.isDir ? (
          node.expanded ? (
            <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate" title={node.entry.name}>
          {node.entry.name}
        </span>
      </button>
      {hasActions && (
        <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button type="button" variant="ghost" size="icon-xs" />
                  }
                  disabled={disabled}
                  aria-label={`${node.entry.name} 的${actionLabel}`}
                  className={cn(
                    "mr-0.5 shrink-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100",
                    !dropdownOpen &&
                      !contextOpen &&
                      "[@media(hover:hover)_and_(pointer:fine)]:opacity-0"
                  )}
                />
              }
            >
              <MoreHorizontalIcon />
            </TooltipTrigger>
            <TooltipContent>{actionLabel}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-44">
            <EntryMenuItems
              isDir={node.entry.isDir}
              disabled={disabled}
              onAction={onAction}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
  if (!hasActions) return row
  return (
    <ContextMenu open={contextOpen} onOpenChange={setContextOpen}>
      <ContextMenuTrigger render={row} />
      <ContextMenuContent className="min-w-44">
        <EntryMenuItems
          isDir={node.entry.isDir}
          context
          disabled={disabled}
          onAction={onAction}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function WorkspaceFileTree({
  nodes,
  selectedRel,
  onSelect,
  onToggle,
  onRetry,
  onEntryAction,
  actionsDisabled,
  depth = 0,
}: TreeProps) {
  if (!nodes.length) return null
  return (
    <ul
      role={depth === 0 ? "tree" : "group"}
      aria-label={depth === 0 ? "任务文件树" : undefined}
      className="min-w-0"
    >
      {nodes.map((node) => (
        <li
          key={node.entry.relPath}
          role="treeitem"
          aria-selected={selectedRel === node.entry.relPath}
          aria-expanded={node.entry.isDir ? node.expanded : undefined}
        >
          <FileTreeRow
            node={node}
            depth={depth}
            selected={selectedRel === node.entry.relPath}
            disabled={actionsDisabled}
            onSelect={() => onSelect(node.entry.relPath)}
            onToggle={() => onToggle(node.entry.relPath)}
            onAction={(action) => onEntryAction(action, node.entry.relPath)}
          />
          {node.error && (
            <div
              className="flex items-center gap-1 py-1 text-[11px] text-destructive"
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              <AlertCircleIcon className="size-3 shrink-0" />
              <span>{node.error}</span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onRetry(node.entry.relPath)}
              >
                重试
              </Button>
            </div>
          )}
          {node.expanded && node.children && (
            <WorkspaceFileTree
              nodes={node.children}
              selectedRel={selectedRel}
              onSelect={onSelect}
              onToggle={onToggle}
              onRetry={onRetry}
              onEntryAction={onEntryAction}
              actionsDisabled={actionsDisabled}
              depth={depth + 1}
            />
          )}
          {node.expanded && node.truncated && (
            <p
              className="py-1 text-[11px] text-muted-foreground"
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              列表已截断：仅显示前 200 项及本次新建项。
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
