"use client"

import "@xyflow/react/dist/style.css"
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type Ref,
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
import { mentionTargets } from "@/lib/chat-mentions"
import {
  editableNode,
  type WorkflowDraft,
  type TaskNode,
} from "@/lib/workflow-draft"
import { TaskBotIdentity } from "./task-bot-identity"
import { compactItemStyles } from "./ui/compact-styles"
import { BotDialog } from "./bot-dialog"
import { ChatMentionInput } from "./chat-mention-input"
import { Input } from "./ui/input"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import type { TaskTemplateSummary } from "@/db/schema"
import type { TemplateChange } from "./templates-settings-panel"
import { WorkflowTemplateMenu } from "./workflow-template-menu"
import {
  useSettingsFormGuard,
  type SettingsLeaveGuard,
} from "./settings-form-guard"

type Bot = { id: string; name: string; job: string; avatar: string }
type Step = Node<Pick<TaskNode, "title" | "instructions" | "mentions">, "step">

function StepCard({ data, selected }: NodeProps<Step>) {
  const name = data.title || "Untitled node"
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
        <CardHeader className="grid-cols-1">
          <CardTitle className="line-clamp-2 wrap-anywhere" title={name}>
            {name}
          </CardTitle>
          <CardDescription className="line-clamp-2 wrap-anywhere whitespace-pre-wrap">
            {data.instructions || "Add task instructions"}
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
      ...data,
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
  guard,
  onDirtyChange,
  onTemplateChange,
}: {
  templateId: string
  name: string
  revision: number
  draft: WorkflowDraft
  bots: Bot[]
  latestRelease: { version: number; revision: number } | null
  guard?: Ref<SettingsLeaveGuard>
  onDirtyChange?: (dirty: boolean) => void
  onTemplateChange?: TemplateChange
}) {
  const router = useRouter()
  const [updated, setUpdated] = useState<TaskTemplateSummary | null>(null)
  const template = updated ?? { id: templateId, name }
  const changeTemplate: TemplateChange = (id, next) => {
    if (onTemplateChange) onTemplateChange(id, next)
    else if (next) setUpdated(next)
    else router.replace("/")
  }
  const { resolvedTheme } = useTheme()
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<Step>(
    draft.nodes.map((node) => {
      const { id, position, title, instructions, mentions } = editableNode(
        node,
        bots
      )
      return {
        id,
        type: "step",
        position,
        data: { title, instructions, mentions },
      }
    })
  )
  const [createdBots, setCreatedBots] = useState<Bot[]>([])
  const availableBots = [
    ...bots,
    ...createdBots.filter(
      (b) => !bots.some((existing) => existing.id === b.id)
    ),
  ]
  const [insertCreated, setInsertCreated] = useState<
    ((bot: Bot) => void) | null
  >(null)
  const formId = useId()
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
  const { discardDialog } = useSettingsFormGuard(
    guard ?? null,
    dirty,
    saving,
    "workflow draft"
  )
  const [focused, setFocused] = useState(false)
  const keysActive = !guard || focused

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
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  function addNode() {
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
        data: { title: "Untitled node", instructions: "", mentions: [] },
      },
    ])
  }

  function updateNode(nodeId: string, fields: Partial<Step["data"]>) {
    setNodes((previous) =>
      previous.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...fields } }
          : node
      )
    )
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
    <section
      className={cn(
        "@container flex min-w-0 flex-col bg-background text-foreground",
        guard ? "min-h-0 flex-1" : "h-dvh"
      )}
      tabIndex={-1}
      onFocusCapture={(e) => setFocused(e.currentTarget.contains(e.target))}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
      onKeyDown={(e) => {
        if (
          e.target instanceof HTMLElement &&
          e.currentTarget.contains(e.target) &&
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === "s"
        ) {
          e.preventDefault()
          save()
        }
      }}
    >
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b px-4 py-2">
        {!guard && (
          <WorkflowIcon
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
        )}
        <div className="min-w-0 flex-1">
          {!guard && (
            <h1 className="truncate type-section-title">{template.name}</h1>
          )}
          <p role="status" className="text-xs text-muted-foreground">
            {pending
              ? "Saving…"
              : publishing
                ? "Publishing…"
                : dirty
                  ? "Unsaved changes"
                  : saved.revision
                    ? "Draft saved"
                    : "Workflow draft"}
            {release && ` · Published v${release.version}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={addNode}>
          <PlusIcon data-icon="inline-start" /> Add node
        </Button>
        <WorkflowTemplateMenu
          template={template}
          dirty={dirty}
          disabled={pending || publishing}
          onSave={save}
          onPublish={publish}
          canPublish={
            !dirty && nodes.length > 0 && release?.revision !== saved.revision
          }
          onChange={changeTemplate}
        />
      </header>
      {error && (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col @min-[660px]:flex-row">
        <div ref={stage} className="relative min-h-0 min-w-0 flex-1">
          <ReactFlow<Step, Edge>
            proOptions={{ hideAttribution: true }}
            nodes={nodes}
            edges={nodes.length === 2 && edges.length === 1
              ? edges.map(edge => ({ ...edge, label: "人工介入", labelStyle: { fill: "var(--muted-foreground)", fontSize: 11 },
                labelBgStyle: { fill: "var(--background)" }, labelBgBorderRadius: 4 }))
              : edges}
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
            deleteKeyCode={keysActive ? ["Backspace", "Delete"] : null}
            panActivationKeyCode={keysActive ? undefined : null}
            selectionKeyCode={keysActive ? undefined : null}
            multiSelectionKeyCode={keysActive ? undefined : null}
            zoomActivationKeyCode={keysActive ? undefined : null}
            zoomOnDoubleClick={false}
          >
            <Background gap={20} color="var(--border)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {!nodes.length && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center text-sm text-muted-foreground">
              Add a node to describe the first task.
            </p>
          )}
        </div>
        {selected && (
          <aside
            aria-label="Node details"
            className="flex max-h-[45%] flex-col gap-4 overflow-auto border-t bg-background p-4 @min-[660px]:max-h-none @min-[660px]:w-72 @min-[660px]:shrink-0 @min-[660px]:border-t-0 @min-[660px]:border-l"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="truncate type-section-title">Node details</h2>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove node"
                onClick={removeSelected}
              >
                <Trash2Icon />
              </Button>
            </div>
            <Field>
              <FieldLabel htmlFor={formId + "-title"}>Task name</FieldLabel>
              <Input
                id={formId + "-title"}
                value={selected.data.title}
                maxLength={160}
                onChange={(e) =>
                  updateNode(selected.id, { title: e.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={formId + "-instructions"}>
                Task instructions
              </FieldLabel>
              <div className="flex min-w-0 flex-col">
                <ChatMentionInput
                  key={selected.id}
                  id={formId + "-instructions"}
                  bots={availableBots}
                  value={selected.data.instructions}
                  mentions={selected.data.mentions}
                  change={(instructions, mentions) =>
                    updateNode(selected.id, {
                      instructions,
                      mentions: mentions.flatMap((m) =>
                        m.kind === "bot" ? [{ ...m, kind: "bot" as const }] : []
                      ),
                    })
                  }
                  onCreateBot={(insert) => setInsertCreated(() => insert)}
                />
              </div>
              <p className="type-meta text-muted-foreground">
                {selected.data.mentions.length
                  ? "Bots work in the order they are first mentioned."
                  : "Select at least one @bot before publishing."}
              </p>
              {!!selected.data.mentions.length && (
                <ol
                  aria-label="Assigned bots in execution order"
                  className="m-0 flex w-full list-none flex-col gap-0.5 p-0 text-left"
                >
                  {mentionTargets(selected.data.mentions).mentionedBotIds.map(
                    (id) => {
                      const bot = availableBots.find((b) => b.id === id)
                      return (
                        <li
                          key={id}
                          className={cn(
                            compactItemStyles,
                            "flex w-full items-center justify-start px-0"
                          )}
                        >
                          {bot ? (
                            <TaskBotIdentity bot={bot} />
                          ) : (
                            <span>Unavailable bot</span>
                          )}
                        </li>
                      )
                    }
                  )}
                </ol>
              )}
            </Field>
          </aside>
        )}
      </div>
      <BotDialog
        showTrigger={false}
        open={!!insertCreated}
        onOpenChange={(open) => {
          if (!open) setInsertCreated(null)
        }}
        onCreated={(bot) => {
          setCreatedBots((previous) => [...previous, bot])
          insertCreated?.(bot)
        }}
      />
      {discardDialog}
    </section>
  )
}
