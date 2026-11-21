export type Mention = {
  kind: "bot" | "file"
  value: string
  label: string
  start: number
  end: number
}

export function mentionQuery(text: string, caret: number, mentions: Mention[]) {
  const match = /(?:^|[^A-Za-z0-9_.+@-])@([^@\r\n]*)$/u.exec(
    text.slice(0, caret)
  )
  if (!match) return null
  const start = caret - match[1].length - 1
  if (mentions.some((m) => start >= m.start && start < m.end)) return null
  return { start, query: match[1] }
}

// Keep references anchored to the selected occurrence, including duplicate bot names.
// Editing the token itself turns it back into plain text.
export function rebaseMentions(
  before: string,
  after: string,
  caret: number,
  mentions: Mention[]
) {
  if (before === after) return mentions
  let start = 0
  while (
    start < caret &&
    start < before.length &&
    before[start] === after[start]
  )
    start++
  let oldEnd = before.length
  let newEnd = after.length
  while (
    oldEnd > start &&
    newEnd > caret &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--
    newEnd--
  }
  const shift = newEnd - oldEnd
  return mentions.flatMap((m) => {
    const rebased =
      m.end <= start
        ? m
        : m.start >= oldEnd
          ? { ...m, start: m.start + shift, end: m.end + shift }
          : null
    if (!rebased || after.slice(rebased.start, rebased.end) !== "@" + m.label)
      return []
    if (/[\p{L}\p{N}_]/u.test(after[rebased.end] ?? "")) return []
    return [rebased]
  })
}

export function mentionTargets(mentions: Mention[]) {
  const ordered = [...mentions].sort((a, b) => a.start - b.start)
  return {
    mentionedBotIds: [
      ...new Set(ordered.filter((m) => m.kind === "bot").map((m) => m.value)),
    ],
    workspacePaths: [
      ...new Set(ordered.filter((m) => m.kind === "file").map((m) => m.value)),
    ],
  }
}
