"use client"

import "@xyflow/react/dist/style.css"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react"
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react"
import { useTheme } from "next-themes"
import { nanoid } from "nanoid"
import { PlusIcon, Trash2Icon, WorkflowIcon } from "lucide-react"
import { saveWorkflowDraft } from "@/actions/workflow-draft"
import { publishTemplateVersion } from "@/actions/template-version"
import type { WorkflowDraft } from "@/lib/workflow-draft"
import { ChatAvatar } from "@/components/chat-avatar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type Bot = { id: string; name: string; job: string; avatar: string }
type Step = Node<{ botId: string; bot?: Bot; instructions: string }, "step">

function StepCard({ data, selected }: NodeProps<Step>) {
  const name = data.bot?.name ?? "Unavailable bot"
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={handleSize}
        aria-label={`Input to ${name}`}
      />
      <Card
        size="sm"
        className={cn(
          "w-52 rounded-xl border shadow-sm",
          selected && "border-ring"
        )}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {data.bot && <ChatAvatar seed={data.bot.avatar} alt="" />}
            <span className="min-w-0 truncate">{name}</span>
          </CardTitle>
          <CardDescription className="line-clamp-2 break-words whitespace-pre-wrap">
            {data.instructions || data.bot?.job || "Add step instructions"}
          </CardDescription>
        </CardHeader>
      </Card>
      <Handle
        type="source"
        position={Position.Right}
        style={handleSize}
        aria-label={`Output from ${name}`}
      />
    </>
  )
}
const nodeTypes = { step: StepCard }
const handleSize = { width: 12, height: 12 }
const subscribeToHydration = () => () => {}
const edgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--muted-foreground)" },
  style: { stroke: "var(--muted-foreground)", strokeWidth: 2 },
}

function draftFrom(
  nodes: Step[],
  edges: Edge[],
  viewport: Viewport
): WorkflowDraft {
  return {
    nodes: nodes.map(({ id, position, data }) => ({
      id,
      botId: data.botId,
      instructions: data.instructions,
      position: { x: position.x, y: position.y },
    })),
    edges: edges.map(({ source, target }) => ({ source, target })),
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  }
}

export function WorkflowEditor({
  templateId,
  name,
  revision,
  draft,
  bots,
  latestRelease,
}: {
  templateId: string
  name: string
  revision: number
  draft: WorkflowDraft
  bots: Bot[]
  latestRelease: { version: number; revision: number } | null
}) {
  const { resolvedTheme } = useTheme()
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<Step>(
    draft.nodes.map(({ id, botId, instructions, position }) => ({
      id,
      type: "step",
      position,
      data: { botId, instructions, bot: bots.find((bot) => bot.id === botId) },
    }))
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    draft.edges.map((edge) => ({
      ...edge,
      id: edge.source + ":" + edge.target,
    }))
  )
  const [viewport, setViewport] = useState(draft.viewport)
  const flow = useRef<ReactFlowInstance<Step, Edge> | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [saved, setSaved] = useState(() => ({
    revision,
    text: JSON.stringify(draftFrom(nodes, edges, viewport)),
  }))
  const current = draftFrom(nodes, edges, viewport)
  const dirty = JSON.stringify(current) !== saved.text
  const [pending, startTransition] = useTransition()
  const saving = useRef(false)
  const [error, setError] = useState("")
  const selected = nodes.find((node) => node.selected)
  const [release, setRelease] = useState(latestRelease)
  const [publishing, startPublish] = useTransition()

  function publish() {
    if (
      dirty ||
      saving.current ||
      !nodes.length ||
      release?.revision === saved.revision
    )
      return
    saving.current = true
    setError("")
    startPublish(async () => {
      try {
        const result = await publishTemplateVersion(templateId, saved.revision)
        if (result.success) setRelease(result.release)
        else setError(result.error)
      } catch {
        setError("Could not reach the server. Please try again.")
      } finally {
        saving.current = false
      }
    })
  }

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function addBot(bot: Bot) {
    if (!stage.current || !flow.current) return
    const rect = stage.current.getBoundingClientRect()
    const columns = rect.width >= 580 ? 2 : 1
    const position = flow.current.screenToFlowPosition({
      x: rect.left + (columns === 1 ? 24 : 64) + (nodes.length % columns) * 268,
      y: rect.top + 60 + Math.floor(nodes.length / columns) * 136,
    })
    const id = nanoid()
    setNodes((previous) => [
      ...previous.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: "step",
        selected: true,
        position,
        data: { botId: bot.id, bot, instructions: "" },
      },
    ])
  }

  function removeSelected() {
    if (!selected) return
    setNodes((previous) => previous.filter((node) => node.id !== selected.id))
    setEdges((previous) =>
      previous.filter(
        (edge) => edge.source !== selected.id && edge.target !== selected.id
      )
    )
  }

  function save() {
    if (saving.current || !dirty) return
    saving.current = true
    setError("")
    startTransition(async () => {
      try {
        const result = await saveWorkflowDraft(
          templateId,
          saved.revision,
          current
        )
        if (result.success)
          setSaved({ revision: result.revision, text: JSON.stringify(current) })
        else setError(result.error)
      } catch {
        setError("Could not reach the server. Please try again.")
      } finally {
        saving.current = false
      }
    })
  }

  return (
    <main className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b px-4 py-2">
        <WorkflowIcon
          aria-hidden="true"
          className="size-5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate type-section-title">{name}</h1>
          <p role="status" className="text-xs text-muted-foreground">
            {pending
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : saved.revision
                  ? "Draft saved"
                  : "Workflow draft"}
            {release && ` · Published v${release.version}`}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <PlusIcon data-icon="inline-start" /> Add bot
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
            <DropdownMenuGroup>
              {bots.map((bot) => (
                <DropdownMenuItem key={bot.id} onClick={() => addBot(bot)}>
                  <ChatAvatar seed={bot.avatar} alt="" />{" "}
                  <span>{bot.name}</span>
                  {bot.job && (
                    <span className="max-w-40 truncate text-muted-foreground">
                      {bot.job}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              {!bots.length && (
                <DropdownMenuItem disabled>
                  Create a bot in Settings first.
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || publishing || !dirty}
          onClick={save}
        >
          Save draft
        </Button>
        <Button
          size="sm"
          disabled={
            dirty ||
            pending ||
            publishing ||
            !nodes.length ||
            release?.revision === saved.revision
          }
          title={dirty ? "Save your changes before publishing." : undefined}
          onClick={publish}
        >
          {publishing
            ? "Publishing…"
            : release?.revision === saved.revision
              ? `Published v${release.version}`
              : `Publish v${(release?.version ?? 0) + 1}`}
        </Button>
      </header>
      {error && (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div ref={stage} className="relative min-h-0 min-w-0 flex-1">
          <ReactFlow<Step, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              flow.current = instance
            }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(connection) =>
              setEdges((previous) => addEdge(connection, previous))
            }
            isValidConnection={({ source, target }) => source !== target}
            defaultEdgeOptions={edgeOptions}
            defaultViewport={draft.viewport}
            minZoom={0.25}
            maxZoom={2}
            onMoveEnd={(_, next) => setViewport(next)}
            colorMode={hydrated && resolvedTheme === "dark" ? "dark" : "light"}
            nodeDragThreshold={0}
            className="[--xy-handle-background-color:var(--foreground)] [--xy-handle-border-color:var(--background)]"
            deleteKeyCode={["Backspace", "Delete"]}
            zoomOnDoubleClick={false}
          >
            <Background gap={20} color="var(--border)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {!nodes.length && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center text-sm text-muted-foreground">
              Add a bot to create the first step.
            </p>
          )}
        </div>
        {selected && (
          <aside
            aria-label="Step details"
            className="flex max-h-[40dvh] flex-col gap-4 overflow-auto border-t bg-background p-4 md:max-h-none md:w-72 md:shrink-0 md:border-t-0 md:border-l"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="truncate type-section-title">
                {selected.data.bot?.name ?? "Unavailable bot"}
              </h2>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove step"
                onClick={removeSelected}
              >
                <Trash2Icon />
              </Button>
            </div>
            <Field>
              <FieldLabel htmlFor="step-instructions">
                Step instructions
              </FieldLabel>
              <Textarea
                id="step-instructions"
                rows={5}
                value={selected.data.instructions}
                onChange={(event) => {
                  const instructions = event.target.value
                  setNodes((previous) =>
                    previous.map((node) =>
                      node.id === selected.id
                        ? { ...node, data: { ...node.data, instructions } }
                        : node
                    )
                  )
                }}
              />
            </Field>
          </aside>
        )}
      </div>
    </main>
  )
}
