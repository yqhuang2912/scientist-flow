import { basename } from "node:path/posix"
import type { ChatJobInput } from "./chat-job"
import { mentionPattern } from "./chat-mentions"

const previewLimit = 80
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function shorten(text: string, limit: number) {
  if (text.length <= limit) return text
  let length = 0
  for (const { index, segment } of graphemes.segment(text)) {
    const end = index + segment.length
    // A single grapheme can contain arbitrarily many combining marks.
    if (end > 1024 || (++length === limit && end < text.length))
      return text.slice(0, index) + "…"
  }
  return text
}

// Use the validated submission, before any file contents or model context are added.
export function chatMessagePreview({
  text,
  files,
  workspacePaths = [],
}: Pick<ChatJobInput, "text" | "files" | "workspacePaths">) {
  if (workspacePaths.length) {
    const mentions = mentionPattern(workspacePaths)
    text = text.replace(mentions, "").trim()
      ? text.replace(mentions, (_, path: string) => "@" + basename(path))
      : ""
  }
  const body = text.trim().replace(/\s+/gu, " ")
  if (body) return shorten(body, previewLimit)

  const first = files[0]?.name ?? basename(workspacePaths[0] ?? "")
  const count = files.length + workspacePaths.length
  const suffix = count > 1 ? ` 等 ${count} 个文件` : ""
  return (
    shorten(
      first.replace(/[\u2028\u2029]/gu, " "),
      previewLimit - suffix.length
    ) + suffix
  )
}
