"use client"

import { memo, type ComponentProps } from "react"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { Streamdown, type ExtraProps } from "streamdown"
import { CheckIcon, CopyIcon } from "lucide-react"
import { MarkdownCodeBlock } from "@/components/markdown-code-block"
import { normalizeDisplayMath } from "@/lib/normalize-display-math"
import { cn } from "@/lib/utils"

function SourceCode({
  className,
  children,
  ...props
}: ComponentProps<"code"> & ExtraProps) {
  const language = /language-(\S+)/.exec(className ?? "")?.[1] ?? ""
  if (!("data-block" in props))
    return (
      <code
        className={cn(
          "rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9333em]",
          className
        )}
        {...props}
      >
        {children}
      </code>
    )
  // HTML, scripts, and Mermaid all stay inert source in workspace previews:
  // a file on disk is untrusted input, so nothing in it gets to execute or draw.
  return (
    <MarkdownCodeBlock
      text={typeof children === "string" ? children : ""}
      language={language}
    />
  )
}

const components = {
  code: SourceCode,
  img: ({ alt }: ComponentProps<"img">) => (
    <span className="text-muted-foreground">
      [Image{alt ? `: ${alt}` : ""}]
    </span>
  ),
}
// Math and CJK shape the text itself; Mermaid is omitted on purpose, since a
// diagram in an untrusted file would be rendered rather than read.
// `$...$` is off by default in the plugin, which leaves inline math as literal
// text in a paper's prose, so it is turned on here.
const plugins = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
}
const icons = { CheckIcon, CopyIcon }

export const DocumentMarkdown = memo(function DocumentMarkdown({
  content,
}: {
  content: string
}) {
  return (
    <Streamdown
      mode="static"
      skipHtml
      plugins={plugins}
      components={components}
      icons={icons}
      controls={false}
      parseIncompleteMarkdown={false}
      urlTransform={(url) => (/^(https?:|mailto:)/i.test(url) ? url : "")}
      className="document-markdown mx-auto max-w-[68ch] min-w-0 type-document wrap-anywhere [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
    >
      {normalizeDisplayMath(content)}
    </Streamdown>
  )
})
