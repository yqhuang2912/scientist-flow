"use client"

import { useEffect, useState, type CSSProperties } from "react"
import {
  code,
  type HighlightResult,
  type HighlightOptions,
} from "@streamdown/code"
import { useIsCodeFenceIncomplete } from "streamdown"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block"

/**
 * Syntax-highlighted fenced code, shared by the chat transcript and the
 * workspace file preview so both surfaces render code identically.
 *
 * Highlighting is async: Shiki resolves a theme and grammar off the render
 * path, so the raw source paints first and tokens replace it once they match
 * the snippet currently on screen.
 */
export function MarkdownCodeBlock({
  text,
  language,
  lineNumbers = true,
}: {
  text: string
  language: string
  lineNumbers?: boolean
}) {
  const incomplete = useIsCodeFenceIncomplete()
  const source = text.replace(/\n$/, "")
  const [highlight, setHighlight] = useState<{
    source: string
    language: string
    result: HighlightResult
  }>()

  useEffect(() => {
    let current = true
    const publish = (result: HighlightResult) => {
      if (current) setHighlight({ source, language, result })
    }
    // Reuse the installed Streamdown highlighter. Late results cannot paint a
    // different snippet or an earlier streaming revision.
    void Promise.resolve()
      .then(() => {
        if (!current) return
        const result = code.highlight(
          {
            code: source,
            language: language as HighlightOptions["language"],
            themes: code.getThemes(),
            isIncomplete: incomplete,
          },
          publish
        )
        if (result) publish(result)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [source, language, incomplete])

  const tokens =
    highlight?.source === source && highlight.language === language
      ? highlight.result.tokens
      : undefined

  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={text} disabled={incomplete} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers={lineNumbers}>
        {source.split("\n").map((line, index) => (
          <CodeBlockLine key={index}>
            {tokens?.[index]?.length
              ? tokens[index].map((token, tokenIndex) => (
                  <span
                    key={tokenIndex}
                    style={
                      {
                        color: token.color,
                        ...token.htmlStyle,
                      } as CSSProperties
                    }
                  >
                    {token.content}
                  </span>
                ))
              : line}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}
