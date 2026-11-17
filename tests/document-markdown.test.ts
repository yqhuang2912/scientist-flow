import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { DocumentMarkdown } from "../components/document-markdown"

test("document previews do not emit executable HTML or remote resource elements", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentMarkdown, {
      content: [
        "# Untrusted document",
        "![tracking](https://example.invalid/track.png)",
        '<script>alert("unsafe")</script>',
        '<iframe src="https://example.invalid/frame"></iframe>',
        '<video src="https://example.invalid/video.mp4"></video>',
        '<img src="https://example.invalid/raw.png" onerror="alert(1)">',
        "[unsafe](javascript:alert(1))",
      ].join("\n\n"),
    })
  )
  assert.doesNotMatch(
    html,
    /<(?:img|script|iframe|video|audio|object|embed|link|style)\b/i
  )
  assert.doesNotMatch(
    html,
    /(?:src|href)="(?:javascript:|https:\/\/example\.invalid)/i
  )
  assert.match(html, /Image: tracking/)
})
test("scripts and Mermaid fences render inert source code", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentMarkdown, {
      content:
        "```mermaid\ngraph TD; A-->B\n```\n\n```html\n<script>alert(1)</script>\n```",
    })
  )
  assert.match(html, /graph TD/)
  assert.doesNotMatch(html, /<script\b|<iframe\b|data-streamdown="mermaid"/i)
  assert.match(html, /&lt;script&gt;/)
})

test("display math renders centered as a block", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentMarkdown, {
      content: String.raw`$$\mathcal{S}=\frac{1}{2}+\mathbb{E}_{\theta}$$`,
    })
  )
  assert.match(html, /class="[^"]*katex/)
  assert.doesNotMatch(html, /katex-error/)
  // katex-display is the block wrapper KaTeX centers; its absence would mean
  // the formula rendered inline in the middle of a paragraph.
  assert.match(html, /katex-display/)
})

test("inline math renders inline, not as a block", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentMarkdown, {
      content: String.raw`The value $\theta_{i}$ appears mid-sentence.`,
    })
  )
  assert.match(html, /class="[^"]*katex/)
  assert.doesNotMatch(html, /katex-error/)
  assert.doesNotMatch(html, /katex-display/)
  assert.match(html, /appears mid-sentence/)
})

test("fenced code keeps single-line $$ as written", () => {
  const html = renderToStaticMarkup(
    createElement(DocumentMarkdown, {
      content: "```\n$$not math$$\n```",
    })
  )
  assert.doesNotMatch(html, /katex/)
  assert.match(html, /\$\$not math\$\$/)
})
