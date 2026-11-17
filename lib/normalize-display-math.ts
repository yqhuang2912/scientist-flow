/**
 * `$$…$$` written on a single line is the common way to type a display
 * formula, but `remark-math` only treats `$$` as a block when the delimiters
 * sit on their own lines. Left alone it renders inline, in the middle of a
 * paragraph, instead of centered on its own.
 *
 * This rewrites the single-line form into the block form before parsing. Only
 * a `$$…$$` that occupies a whole line is touched, so a formula that is
 * genuinely part of a sentence keeps its place, and anything inside a fenced
 * code block is left exactly as written.
 */
export function normalizeDisplayMath(markdown: string): string {
  const lines = markdown.split("\n")
  const output: string[] = []
  let fence: string | null = null

  for (const line of lines) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      // A fence closes only on the same character, and on a run at least as
      // long as the one that opened it.
      if (fence === null) fence = marker[0].repeat(marker.length)
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = null
      output.push(line)
      continue
    }
    if (fence !== null) {
      output.push(line)
      continue
    }

    // A whole line that is exactly one `$$…$$`, with content between the
    // delimiters. `$$$$` and a lone `$$` are left alone.
    const match = /^(\s*)\$\$(.+)\$\$\s*$/.exec(line)
    if (match && !match[2].includes("$$")) {
      const indent = match[1]
      output.push(`${indent}$$`, `${indent}${match[2].trim()}`, `${indent}$$`)
      continue
    }
    output.push(line)
  }

  return output.join("\n")
}
