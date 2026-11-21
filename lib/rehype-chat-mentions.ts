import type { ElementContent, Root } from "hast"
import type { Construct, State } from "micromark-util-types"
import type { Processor } from "unified"
import { SKIP, visit } from "unist-util-visit"

// A selected path such as docs/[report](final).md is literal text, even
// though part of its name would normally be parsed as a Markdown link.
function literalMention(label: string): Construct {
  const literal = "@" + label
  return {
    tokenize(effects, ok, nok) {
      let offset = 0
      const consume: State = (code) => {
        if (offset === literal.length) {
          effects.exit("data")
          return ok(code)
        }
        if (code !== literal.charCodeAt(offset)) return nok(code)
        if (offset === 0) {
          if (
            this.previous !== null &&
            /[\w.+@/\\-]/.test(String.fromCharCode(this.previous))
          )
            return nok(code)
          effects.enter("data")
        }
        effects.consume(code)
        offset++
        return consume
      }
      return consume
    },
  }
}

// Only decorate the bot names and workspace paths referenced by this message.
export function rehypeChatMentions(
  this: Processor,
  { labels }: { labels: string[] }
) {
  const ordered = [...new Set(labels)].sort((a, b) => b.length - a.length)
  const data = this.data()
  data.micromarkExtensions ??= []
  data.micromarkExtensions.push({ text: { 64: ordered.map(literalMention) } })
  const alternatives = ordered.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  )
  const pattern = new RegExp(
    String.raw`(?<![\w.+@/\\-])@(${alternatives.join("|")})(?![\p{L}\p{N}_/@\\-]|\.[\p{L}\p{N}])`,
    "gu"
  )

  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (
        node.type === "element" &&
        (["a", "code", "pre", "math", "svg"].includes(node.tagName) ||
          (Array.isArray(node.properties.className) &&
            node.properties.className.includes("katex")))
      )
        return SKIP
      if (node.type !== "text" || !parent || index === undefined) return
      const parts: ElementContent[] = []
      let end = 0
      for (const match of node.value.matchAll(pattern)) {
        if (end < match.index)
          parts.push({
            type: "text",
            value: node.value.slice(end, match.index),
          })
        end = match.index + match[0].length
        parts.push({
          type: "element",
          tagName: "chat-mention",
          properties: /^[ \t]/.test(node.value.slice(end, end + 1))
            ? { className: ["me-1.5"] }
            : {},
          children: [{ type: "text", value: match[1] }],
        })
      }
      if (!parts.length) return
      if (end < node.value.length)
        parts.push({ type: "text", value: node.value.slice(end) })
      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}
