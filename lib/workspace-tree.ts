import {
  isWorkspaceSubtree,
  workspaceParentPath,
  type WorkspaceEntry,
} from "./workspace-validation"

export interface WorkspaceTreeNode {
  entry: WorkspaceEntry
  children: WorkspaceTreeNode[] | null
  expanded: boolean
  loading: boolean
  error: string | null
  truncated: boolean
}

export function mergeWorkspaceChildren(
  previous: WorkspaceTreeNode[],
  entries: WorkspaceEntry[]
) {
  const existing = new Map(previous.map((node) => [node.entry.relPath, node]))
  return entries.map((entry): WorkspaceTreeNode => {
    const node = existing.get(entry.relPath)
    if (node && node.entry.isDir === entry.isDir) return { ...node, entry }
    return {
      entry,
      children: null,
      expanded: false,
      loading: false,
      error: null,
      truncated: false,
    }
  })
}

export function updateWorkspaceNode(
  nodes: WorkspaceTreeNode[],
  relative: string,
  update: (node: WorkspaceTreeNode) => WorkspaceTreeNode
): WorkspaceTreeNode[] {
  return nodes.map((node) => {
    if (node.entry.relPath === relative) return update(node)
    if (node.children && isWorkspaceSubtree(relative, node.entry.relPath))
      return {
        ...node,
        children: updateWorkspaceNode(node.children, relative, update),
      }
    return node
  })
}

export function findWorkspaceNode(
  nodes: WorkspaceTreeNode[],
  relative: string
): WorkspaceTreeNode | null {
  for (const node of nodes) {
    if (node.entry.relPath === relative) return node
    if (node.children && isWorkspaceSubtree(relative, node.entry.relPath))
      return findWorkspaceNode(node.children, relative)
  }
  return null
}

export function removeWorkspaceSubtree(
  nodes: WorkspaceTreeNode[],
  relative: string
): WorkspaceTreeNode[] {
  return nodes
    .filter((node) => !isWorkspaceSubtree(node.entry.relPath, relative))
    .map((node) =>
      node.children && isWorkspaceSubtree(relative, node.entry.relPath)
        ? { ...node, children: removeWorkspaceSubtree(node.children, relative) }
        : node
    )
}

export function selectionAfterDirectoryDeletion(
  selected: string | null,
  relative: string
) {
  return selected && isWorkspaceSubtree(selected, relative)
    ? workspaceParentPath(relative) || null
    : selected
}

// Each directory has an independent sequence. Mutations invalidate ancestors
// (whose listing may include the target) and descendants (which may be gone).
export class WorkspaceDirectoryReads {
  private versions = new Map<string, number>()
  begin(relative: string) {
    const version = (this.versions.get(relative) ?? 0) + 1
    this.versions.set(relative, version)
    return version
  }
  current(relative: string, version: number) {
    return this.versions.get(relative) === version
  }
  invalidate(relative: string) {
    for (const key of this.versions.keys()) {
      if (
        key === "" ||
        isWorkspaceSubtree(key, relative) ||
        isWorkspaceSubtree(relative, key)
      )
        this.begin(key)
    }
  }
}
