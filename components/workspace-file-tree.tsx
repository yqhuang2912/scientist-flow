"use client"

import { useState } from "react"
import {
  compactItemStyles,
  compactItemTypography,
  compactItemStates,
  compactListStyles,
} from "@/components/ui/compact-styles"
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FilePlusIcon,
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
import { WorkspaceEntryIcon } from "@/components/workspace-entry-icon"

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
          <Item disabled={disabled} onClick={() => onAction("create-file")}>
            <FilePlusIcon />
            New file
          </Item>
          <Item disabled={disabled} onClick={() => onAction("create")}>
            <FolderPlusIcon />
            New folder
          </Item>
          <Separator />
        </>
      )}
      <Item
        disabled={disabled}
        variant="destructive"
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
  selected,
  disabled,
  onSelect,
  onToggle,
  onAction,
}: {
  node: WorkspaceTreeNode
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
      data-active={selected || undefined}
      className={cn(
        compactItemTypography,
        compactItemStates,
        "group/tree-row relative flex min-w-0 items-center rounded-xl ring-ring ring-inset focus-within:bg-highlight has-[[data-workspace-path]:focus-visible]:ring-2",
        (dropdownOpen || contextOpen) && "bg-highlight text-foreground"
      )}
    >
      <button
        type="button"
        data-workspace-path={node.entry.relPath}
        aria-label={node.entry.name}
        aria-expanded={node.entry.isDir ? node.expanded : undefined}
        className={cn(
          compactItemStyles,
          "relative flex h-7.5 min-w-0 flex-1 items-center pr-1 text-left outline-none"
        )}
        onClick={() => {
          onSelect()
          if (node.entry.isDir) onToggle()
        }}
      >
        <span
          aria-hidden="true"
          className="absolute -left-3.5 flex size-3 items-center justify-center text-muted-foreground [&_svg]:size-3"
        >
          {node.entry.isDir &&
            (node.loading ? (
              <Spinner />
            ) : node.expanded ? (
              <ChevronDownIcon />
            ) : (
              <ChevronRightIcon />
            ))}
        </span>
        <WorkspaceEntryIcon entry={node.entry} expanded={node.expanded} />
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
                    "mr-1 shrink-0 text-muted-foreground",
                    "group-focus-within/tree-row:opacity-100 group-hover/tree-row:opacity-100",
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
      className={cn(
        compactListStyles,
        "min-w-0",
        depth === 0 ? "pl-4" : "ml-4 border-l border-border/80 pl-1"
      )}
    >
      {nodes.map((node) => (
        <li
          key={node.entry.relPath}
          role="treeitem"
          className="flex min-w-0 flex-col gap-0.5"
          aria-selected={selectedRel === node.entry.relPath}
          aria-expanded={node.entry.isDir ? node.expanded : undefined}
        >
          <FileTreeRow
            node={node}
            selected={selectedRel === node.entry.relPath}
            disabled={actionsDisabled}
            onSelect={() => onSelect(node.entry.relPath)}
            onToggle={() => onToggle(node.entry.relPath)}
            onAction={(action) => onEntryAction(action, node.entry.relPath)}
          />
          {node.error && (
            <div className="flex items-center gap-1 py-1 text-[11px] text-destructive">
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
            <p className="py-1 text-[11px] text-muted-foreground">
              列表已截断：仅显示前 200 项及本次新建项。
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
