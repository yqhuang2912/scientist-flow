"use client"

import { useState } from "react"
import {
  AlertCircleIcon,
  ChevronRightIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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

// Shared menu items for both DropdownMenu and ContextMenu surfaces.
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
        {isDir ? "Delete folder" : "Delete file"}
      </Item>
    </Group>
  )
}

function FileTreeRow({
  node,
  selected,
  disabled,
  onSelect,
  onAction,
}: {
  node: WorkspaceTreeNode
  selected: boolean
  disabled: boolean
  onSelect: () => void
  onAction: (action: WorkspaceEntryAction) => void
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const hasActions = node.entry.isDir || node.entry.isFile === true
  const actionLabel = node.entry.isDir ? "Folder actions" : "File actions"
  const menuOpen = dropdownOpen || contextOpen
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-workspace-path={node.entry.relPath}
      aria-label={node.entry.name}
      aria-current={selected ? "true" : undefined}
      aria-busy={node.loading || undefined}
      onClick={onSelect}
      className={cn(
        "w-full min-w-0 justify-start font-normal group-hover/tree-row:bg-highlight",
        hasActions && "pr-9",
        selected || menuOpen
          ? "bg-accent text-accent-foreground aria-expanded:bg-accent"
          : "aria-expanded:bg-transparent aria-expanded:group-hover/tree-row:bg-highlight"
      )}
    >
      {node.entry.isDir ? (
        <>
          {node.loading ? (
            <Spinner />
          ) : (
            <ChevronRightIcon className="transition-transform group-data-panel-open/button:rotate-90 motion-reduce:transition-none" />
          )}
          <FolderIcon />
        </>
      ) : (
        <FileIcon />
      )}
      <span className="min-w-0 truncate" title={node.entry.name}>
        {node.entry.name}
      </span>
    </Button>
  )

  const rowContent = (
    <div className="group/tree-row relative min-w-0">
      {node.entry.isDir ? <CollapsibleTrigger render={button} /> : button}

      {/* A sibling control: opening a menu never toggles the folder. */}
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
                  aria-label={`${actionLabel}: ${node.entry.name}`}
                  className={cn(
                    "absolute top-1/2 right-1 -translate-y-1/2",
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

  if (!hasActions) return rowContent

  return (
    <ContextMenu open={contextOpen} onOpenChange={setContextOpen}>
      <ContextMenuTrigger render={rowContent} />
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

function FileTreeNode({
  node,
  selectedRel,
  onSelect,
  onToggle,
  onRetry,
  onEntryAction,
  actionsDisabled,
  depth,
}: {
  node: WorkspaceTreeNode
  selectedRel: string | null
  onSelect: (r: string) => void
  onToggle: (r: string) => void
  onRetry: (r: string) => void
  onEntryAction: (a: WorkspaceEntryAction, r: string) => void
  actionsDisabled: boolean
  depth: number
}) {
  const row = (
    <FileTreeRow
      node={node}
      selected={selectedRel === node.entry.relPath}
      disabled={actionsDisabled}
      onSelect={() => onSelect(node.entry.relPath)}
      onAction={(action) => onEntryAction(action, node.entry.relPath)}
    />
  )
  if (!node.entry.isDir) return row

  return (
    <Collapsible
      open={node.expanded}
      onOpenChange={() => onToggle(node.entry.relPath)}
      className="min-w-0"
    >
      {row}
      <CollapsibleContent>
        <div className="ml-4 flex min-w-0 flex-col">
          {node.error && (
            <div
              role="alert"
              className="flex items-center gap-2 px-2.5 py-1 text-xs text-destructive"
            >
              <AlertCircleIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{node.error}</span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onRetry(node.entry.relPath)}
              >
                Retry
              </Button>
            </div>
          )}
          {node.children && (
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
          {node.truncated && (
            <p className="px-2.5 py-1 text-xs text-muted-foreground">
              Showing the first 200 items and newly created items.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
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
    <div
      role={depth === 0 ? "group" : undefined}
      aria-label={depth === 0 ? "Workspace files" : undefined}
      className="flex min-w-0 flex-col"
    >
      {nodes.map((node) => (
        <FileTreeNode
          key={node.entry.relPath}
          node={node}
          selectedRel={selectedRel}
          onSelect={onSelect}
          onToggle={onToggle}
          onRetry={onRetry}
          onEntryAction={onEntryAction}
          actionsDisabled={actionsDisabled}
          depth={depth}
        />
      ))}
    </div>
  )
}
