import { GFM, parser } from "@lezer/markdown"

const markdown = parser.configure(GFM)
const literalNodes = new Set([
  "InlineCode",
  "FencedCode",
  "CodeBlock",
  "HTMLBlock",
  "HTMLTag",
  "Autolink",
  "URL",
  "LinkTitle",
  "LinkReference",
  "CommentBlock",
])

// Keep display fences inside their Markdown container, including when a model
// writes a whole equation on one line of a list or blockquote.
function displayDelimiter(source: string, at: number) {
  const before = source.slice(source.lastIndexOf("\n", at - 1) + 1, at)
  const prefix = /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)?/.exec(before)![0]
  const indent = prefix.replace(/[-*+]|\d+[.)]/, (mark) =>
    " ".repeat(mark.length)
  )
  const newline = "\n" + indent
  let after = at + 2
  while (source[after] === " " || source[after] === "\t") after++
  const endsLine = after === source.length || /[\r\n]/.test(source[after])
  return (before === prefix ? "" : newline) + "$$" + (endsLine ? "" : newline)
}

// Streamdown accepts double-dollar delimiters for both inline and display math.
// Only rewrite complete pairs in prose, so copying, stored text and incomplete
// streaming messages all retain their original source.
export function normalizeChatMath(source: string) {
  if (
    !source.includes("\\(") &&
    !source.includes("\\[") &&
    !source.includes("$")
  )
    return source
  let result = ""
  let copied = 0

  function scan(from: number, to: number) {
    const markers = /\\[\\()[\]$]|\$+/g
    const prose = source.slice(from, to)
    let open: { marker: string; close: string; at: number } | undefined

    for (const match of prose.matchAll(markers)) {
      const marker = match[0]
      const at = from + match.index
      if (marker === open?.close) {
        // In "$5 and $10", the second dollar starts a price.
        if (
          marker !== "$" ||
          (!/\s/.test(source[at - 1]) &&
            !/\d/.test(source[at + 1] ?? "") &&
            !source.slice(open.at, at).includes("\n"))
        ) {
          if (!marker.startsWith("$$")) {
            const display = marker === "\\]"
            result += source.slice(copied, open.at)
            // Adjacent dollar fences would otherwise merge into a single run.
            if (!display && result.endsWith("$")) result += "<!---->"
            result += display ? displayDelimiter(source, open.at) : "$$"
            result +=
              source.slice(open.at + open.marker.length, at) +
              (display ? displayDelimiter(source, at) : "$$")
            copied = at + marker.length
            if (!display && source[copied] === "$") result += "<!---->"
          }
          open = undefined
          continue
        }
        open = undefined
      }
      // Dollar signs inside explicit LaTeX (and all delimiters in native
      // double-dollar math) belong to that expression.
      if (open && open.marker !== "$" && marker !== open.marker) continue
      if (marker === "\\(" || marker === "\\[") {
        open = { marker, at, close: marker === "\\(" ? "\\)" : "\\]" }
      } else if (
        marker.startsWith("$") &&
        (marker.length > 1 || !/\s/.test(source[at + 1] ?? " "))
      ) {
        open = { marker, at, close: marker }
      }
    }
  }

  let proseStart = 0
  markdown.parse(source).iterate({
    enter({ name, from, to }) {
      if (literalNodes.has(name)) {
        scan(proseStart, from)
        proseStart = to
        return false
      }
    },
  })
  scan(proseStart, source.length)
  return result + source.slice(copied)
}
