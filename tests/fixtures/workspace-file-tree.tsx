"use client"

// Isolated visual/interaction fixture. No filesystem or server actions.
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { WorkspaceFileTree } from "@/components/workspace-file-tree"
import {
  updateWorkspaceNode,
  type WorkspaceTreeNode,
} from "@/lib/workspace-tree"
import { cn } from "@/lib/utils"

function node(path: string, children?: WorkspaceTreeNode[]): WorkspaceTreeNode {
  return {
    entry: {
      name: path.split("/").at(-1)!,
      relPath: path,
      isDir: children !== undefined,
      isFile: children === undefined,
    },
    children: children ?? null,
    expanded: children !== undefined,
    loading: false,
    error: null,
    truncated: false,
  }
}

function initialTree() {
  return [
    node("docs", [
      node("docs/notes.md"),
      node("docs/references", [node("docs/references/sources.bib")]),
      node("docs/reproducible-research-methods-and-experiment-notes.md"),
    ]),
    { ...node("src", [node("src/analysis.py")]), expanded: false },
    node("outputs", []),
    { ...node("unavailable", []), error: "Could not read this folder." },
    node("README.md"),
  ]
}

export default function WorkspaceFileTreeFixture() {
  const [nodes, setNodes] = useState(initialTree)
  const [selected, setSelected] = useState<string | null>("docs/notes.md")
  const [narrow, setNarrow] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [event, setEvent] = useState("No operation")
  const [toggles, setToggles] = useState(0)

  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 bg-background p-6 text-foreground">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setNarrow(!narrow)}>
          Width
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDisabled(!disabled)}
        >
          Toggle pending
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setNodes(initialTree())
            setSelected("docs/notes.md")
            setToggles(0)
            setEvent("No operation")
          }}
        >
          Reset
        </Button>
      </div>
      <section
        aria-label="Workspace fixture"
        className={cn("w-full max-w-96", narrow && "max-w-64")}
      >
        <WorkspaceFileTree
          nodes={nodes}
          selectedRel={selected}
          onSelect={setSelected}
          onToggle={(path) => {
            setToggles((count) => count + 1)
            setNodes((previous) =>
              updateWorkspaceNode(previous, path, (value) => ({
                ...value,
                expanded: !value.expanded,
              }))
            )
          }}
          onRetry={(path) =>
            setNodes((previous) =>
              updateWorkspaceNode(previous, path, (value) => ({
                ...value,
                error: null,
              }))
            )
          }
          onEntryAction={(action, path) => setEvent(`${action}: ${path}`)}
          actionsDisabled={disabled}
        />
      </section>
      <output className="text-xs text-muted-foreground">
        Selected: {selected ?? "none"} · Toggles: {toggles} · {event}
      </output>
    </main>
  )
}
