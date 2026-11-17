import assert from "node:assert/strict"
import { test } from "node:test"
import {
  findWorkspaceNode,
  mergeWorkspaceChildren,
  removeWorkspaceSubtree,
  selectionAfterDirectoryDeletion,
  WorkspaceDirectoryReads,
} from "../lib/workspace-tree"

const entry = (relPath: string) => ({
  relPath,
  name: relPath.split("/").at(-1)!,
  isDir: true,
})

test("branch refresh preserves other expansions and cached descendants", () => {
  const tree = mergeWorkspaceChildren([], [entry("docs"), entry("data")])
  tree[0].expanded = true
  tree[0].children = mergeWorkspaceChildren([], [entry("docs/deep")])
  tree[1].expanded = true
  tree[1].children = []
  const refreshed = mergeWorkspaceChildren(tree, [
    entry("docs"),
    entry("data"),
    entry("new"),
  ])
  assert.equal(refreshed[0].children, tree[0].children)
  assert.equal(refreshed[1].expanded, true)
  assert.equal(refreshed[2].children, null)
})

test("deletion removes subtree caches and uses segment boundaries for selection", () => {
  const tree = mergeWorkspaceChildren([], [entry("docs"), entry("docs-other")])
  tree[0].children = mergeWorkspaceChildren([], [entry("docs/child")])
  const next = removeWorkspaceSubtree(tree, "docs")
  assert.equal(findWorkspaceNode(next, "docs/child"), null)
  assert.equal(next[0], tree[1])
  assert.equal(
    selectionAfterDirectoryDeletion("docs/child/file", "docs/child"),
    "docs"
  )
  assert.equal(selectionAfterDirectoryDeletion("docs/child/file", "docs"), null)
  assert.equal(
    selectionAfterDirectoryDeletion("docs-other", "docs"),
    "docs-other"
  )
})

test("stale reads cannot resurrect mutations; unrelated branches stay current", () => {
  const reads = new WorkspaceDirectoryReads()
  const root = reads.begin("")
  const docs = reads.begin("docs")
  const child = reads.begin("docs/child")
  const other = reads.begin("data")
  reads.invalidate("docs/child")
  assert.equal(reads.current("", root), false)
  assert.equal(reads.current("docs", docs), false)
  assert.equal(reads.current("docs/child", child), false)
  assert.equal(reads.current("data", other), true)
  const current = reads.begin("docs")
  assert.equal(reads.current("docs", current), true)
  assert.equal(new WorkspaceDirectoryReads().current("docs", current), false)
})

test("file deletion preserves sibling files and parent expansion, selecting the parent", () => {
  const tree = mergeWorkspaceChildren([], [entry("docs"), entry("data")])
  tree[0].expanded = true
  tree[0].children = mergeWorkspaceChildren(
    [],
    [
      {
        name: "notes.md",
        relPath: "docs/notes.md",
        isDir: false,
        isFile: true,
      },
      {
        name: "notes.md.bak",
        relPath: "docs/notes.md.bak",
        isDir: false,
        isFile: true,
      },
    ]
  )
  const next = removeWorkspaceSubtree(tree, "docs/notes.md")
  assert.equal(next[0].expanded, true)
  assert.equal(next[0].children?.length, 1)
  assert.equal(next[0].children?.[0].entry.relPath, "docs/notes.md.bak")
  assert.equal(next[1], tree[1])
  assert.equal(
    selectionAfterDirectoryDeletion("docs/notes.md", "docs/notes.md"),
    "docs"
  )
  assert.equal(selectionAfterDirectoryDeletion("notes.md", "notes.md"), null)
  assert.equal(
    selectionAfterDirectoryDeletion("docs/notes.md.bak", "docs/notes.md"),
    "docs/notes.md.bak"
  )
})
