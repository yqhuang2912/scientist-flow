"use client"

import { memo, type ComponentProps } from "react"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import {
  Streamdown,
  defaultComponents,
  defaultRemarkPlugins,
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

const components = { code: MarkdownCode }
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
