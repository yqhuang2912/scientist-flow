/** Add whitespace to single-line JSON without converting scientific number literals. */
export function formatDatasetJson(source: string): string {
  if (source.trim().includes("\n")) return source
  try {
    JSON.parse(source)
  } catch {
    return source
  }
  const tokens =
    source.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g) ?? []
  const pieces: string[] = []
  let depth = 0
  let length = 0
  const indent = () => "\n" + "  ".repeat(Math.min(depth, 16))
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    let piece = token
    if (token === "[" || token === "{") {
      depth++
      if (tokens[i + 1] !== "]" && tokens[i + 1] !== "}") piece += indent()
    } else if (token === "]" || token === "}") {
      depth--
      if (tokens[i - 1] !== "[" && tokens[i - 1] !== "{")
        piece = indent() + token
    } else if (token === ",") piece += indent()
    else if (token === ":") piece += " "
    length += piece.length
    if (length > 4 * 1024 * 1024) return source
    pieces.push(piece)
  }
  return pieces.join("")
}
