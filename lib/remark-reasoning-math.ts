import type { Root, RootContent, Text } from "mdast"
import type { InlineMath } from "mdast-util-math"

// Some reasoning traces use Unicode operators and unmarked, subscripted
// variables. Only typeset a name if a mathematical relation establishes it
// in this thought. Leave filenames, code, links and existing math alone.
const variable = /[A-Za-z]_[a-z0-9]+/g
const operator = /[∩∪∈∉⊂⊆⊃⊇≤≥≠≈]/
const expression = new RegExp(
  String.raw`(?<![\w./@\\-])${variable.source}(?:[ \t]*${operator.source}[ \t]*${variable.source})*(?![\w/@\\-]|\.\w)`,
  "g"
)

function subscript(symbol: string) {
  const [base, sub] = symbol.split("_")
  return sub.length === 1
    ? base + "_{" + sub + "}"
    : base + "_{\\text{" + sub + "}}"
}

function inlineMath(value: string): InlineMath {
  return {
    type: "inlineMath",
    value,
    data: {
      hName: "code",
      hProperties: { className: ["language-math", "math-inline"] },
      hChildren: [{ type: "text", value }],
    },
  }
}

export function remarkReasoningMath() {
  return (tree: Root) => {
    const variables = new Set<string>()
    const candidates: { children: RootContent[]; index: number; text: Text }[] =
      []

    function collect(children: RootContent[]) {
      children.forEach((child, index) => {
        if (child.type === "text" && child.value.includes("_")) {
          candidates.push({ children, index, text: child })
          for (const [value] of child.value.matchAll(expression)) {
            if (operator.test(value))
              for (const [name] of value.matchAll(variable)) variables.add(name)
          }
        } else if (
          "children" in child &&
          child.type !== "link" &&
          child.type !== "linkReference"
        ) {
          collect(child.children)
        }
      })
    }
    collect(tree.children)
    if (!variables.size) return

    // Replace later siblings first so the recorded indices stay valid.
    for (const { children, index, text } of candidates.reverse()) {
      const parts: (Text | InlineMath)[] = []
      let end = 0
      for (const match of text.value.matchAll(expression)) {
        const [value] = match
        if (!variables.has(value) && !operator.test(value)) continue
        if (match.index > end)
          parts.push({
            type: "text",
            value: text.value.slice(end, match.index),
          })
        parts.push(inlineMath(value.replace(variable, subscript)))
        end = match.index + value.length
      }
      if (!parts.length) continue
      if (end < text.value.length)
        parts.push({ type: "text", value: text.value.slice(end) })
      children.splice(index, 1, ...parts)
    }
  }
}
