"use client"

import { useParams } from "next/navigation"
import { FileTypeIcon } from "@/components/file-type-icon"
import { ImagePreview } from "@/components/image-preview"
import { workspaceImageSource } from "@/lib/workspace-document"
import { workspaceOpenPolicy } from "@/lib/workspace-open-policy"
import { safeChatUrl, safeChatImageUrl } from "@/lib/chat-presentation"
import type { Element, ElementContent, Root } from "hast"
import { visit } from "unist-util-visit"
import { memo, type ComponentProps } from "react"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import {
  Streamdown,
  defaultComponents,
  defaultRemarkPlugins,
  defaultRehypePlugins,
  type ExtraProps,
} from "streamdown"
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"
import { MarkdownCodeBlock } from "@/components/markdown-code-block"
import { normalizeChatMath } from "@/lib/chat-math"
import { remarkReasoningMath } from "@/lib/remark-reasoning-math"
import { cn } from "@/lib/utils"
import "@/components/chat-markdown.css"

function MarkdownCode({
  node,
  className,
  children,
  ...props
}: ComponentProps<"code"> & ExtraProps) {
  const language = /language-(\S+)/.exec(className ?? "")?.[1] ?? ""
  if (!("data-block" in props) || language === "mermaid") {
    const StreamdownCode = defaultComponents.code
    return (
      <StreamdownCode node={node} className={className} {...props}>
        {children}
      </StreamdownCode>
    )
  }
  return (
    <MarkdownCodeBlock
      text={typeof children === "string" ? children : ""}
      language={language}
    />
  )
}

function workspaceImagePath(src: string) {
  try {
    const path = decodeURIComponent(src).replace(/^\.\//, "")
    if (workspaceOpenPolicy(path).kind === "internal-image") return path
  } catch {
    /* Malformed Markdown URL. */
  }
}

// Streamdown's URL filter requires an absolute URL. Only validated workspace
// images get a local renderer, after sanitization and before URL filtering.
function rehypeWorkspaceImages() {
  return (tree: Root) => {
    // A linked Markdown image gets its own preview control. Text beside the
    // image retains its original link without nesting a button inside an anchor.
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "a" || !parent || index === undefined ||
          !node.children.some(child => child.type === "element" && child.tagName === "img")) return
      const items: Element[] = []
      let run: ElementContent[] = []
      for (const child of node.children) {
        if (child.type === "element" && child.tagName === "img") {
          if (run.length) items.push({...node, children: run})
          run = []
          items.push(child)
        } else run.push(child)
      }
      if (run.length) items.push({...node, children: run})
      parent.children.splice(index, 1, ...items)
      return index + items.length
    })
    visit(tree, "element", (node) => {
      if (node.tagName !== "img") return
      if (
        typeof node.properties.src === "string" &&
        workspaceImagePath(node.properties.src)
      )
        node.tagName = "workspace-image"
    })
  }
}
const chatRehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  rehypeWorkspaceImages,
  defaultRehypePlugins.harden,
]

function MarkdownImage(props: ComponentProps<"img"> & ExtraProps) {
  const params = useParams<{ chatId?: string }>()
  const src = typeof props.src === "string" ? props.src : ""
  if (!src || src.startsWith("streamdown:")) return <>{props.alt}</>
  const name = props.alt || workspaceImagePath(src)?.split("/").at(-1) || "Image"
  const remote =
    safeChatUrl(src) ??
    safeChatImageUrl(src, src.match(/^data:(image\/[a-z]+);base64,/)?.[1] ?? "")
  let source
  if (remote) source = { name, url: remote }
  else if (params?.chatId) {
    const relativePath = workspaceImagePath(src)
    if (relativePath)
      source = workspaceImageSource({ chatId: params.chatId, relativePath })
  }
  if (!source) return <>{props.alt}</>
  return (
    <ImagePreview
      source={source}
      trigger={
        <button type="button" aria-label={`Preview ${name}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-card px-2 py-1 align-middle text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <FileTypeIcon mediaType="image/png" className="size-4" />
          <span className="truncate">{name}</span>
        </button>
      }
    />
  )
}

const components = {
  code: MarkdownCode,
  img: MarkdownImage,
  "workspace-image": MarkdownImage,
}
const plugins = { cjk, code, math, mermaid }
const reasoningPlugins = { cjk, math }
const reasoningComponents = {
  img: ({ alt }: ComponentProps<"img">) => <>{alt}</>,
}
const reasoningRemarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  remarkReasoningMath,
]
// Earlier references and their defining expression can be in different paragraphs.
const wholeThought = (source: string) => [source]
const icons = {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  Maximize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
}
const diagram: ComponentProps<typeof Streamdown>["mermaid"] = {
  config: {
    theme: "neutral",
    fontFamily: "var(--font-sans)",
    themeVariables: { fontSize: "13px" },
    flowchart: {
      padding: 12,
      nodeSpacing: 28,
      rankSpacing: 36,
      curve: "linear",
    },
    themeCSS: `
      .node rect, .node circle, .node ellipse, .node polygon, .node path, .actor, .labelBox {
        fill: var(--card, #ffffff); stroke: var(--border, #e5e5e5);
      }
      .node rect, .actor { rx: 6px; ry: 6px; }
      .nodeLabel, .nodeLabel p, .label text, .actor text, text.actor,
      .messageText, .labelText, .loopText, .edgeLabel, .edgeLabel p {
        color: var(--foreground, #171717); fill: var(--foreground, #171717);
      }
      .edgeLabel, .edgeLabel p, .labelBkg { background: var(--muted, #f5f5f5); }
      .edgePath .path, .flowchart-link, .actor-line, .messageLine0, .messageLine1 { stroke: var(--muted-foreground, #737373); }
      .marker { fill: var(--muted-foreground, #737373); stroke: var(--muted-foreground, #737373); }
      .cluster rect, .note { fill: var(--muted, #f5f5f5); stroke: var(--border, #e5e5e5); }
      .cluster-label text, .cluster-label span, .noteText { color: var(--foreground, #171717); fill: var(--foreground, #171717); }
    `,
  },
}

export const ChatMarkdown = memo(function ChatMarkdown({
  className,
  children,
  variant = "assistant",
  ...props
}: ComponentProps<typeof Streamdown> & {
  variant?: "assistant" | "user" | "reasoning"
}) {
  const reasoning = variant === "reasoning"
  return (
    <Streamdown
      className={cn(
        "chat-markdown w-full min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_[data-streamdown=inline-code]]:rounded-sm [&_[data-streamdown=inline-code]]:bg-surface [&_[data-streamdown=table-header]]:bg-surface/80",
        reasoning
          ? "text-sm leading-6 font-medium"
          : variant === "user"
            ? "type-chat-prompt"
            : "type-chat-response",
        className
      )}
      plugins={reasoning ? reasoningPlugins : plugins}
      components={reasoning ? reasoningComponents : components}
      rehypePlugins={reasoning ? undefined : chatRehypePlugins}
      remarkPlugins={reasoning ? reasoningRemarkPlugins : undefined}
      parseMarkdownIntoBlocksFn={reasoning ? wholeThought : undefined}
      skipHtml={reasoning}
      icons={icons}
      mermaid={diagram}
      {...props}
    >
      {children && normalizeChatMath(children)}
    </Streamdown>
  )
})
