import { z } from "zod"
import type { FileUIPart, TextUIPart } from "ai"
import {
  uploadWorkspaceFileSchema,
  workspaceFileNameSchema,
  workspaceFileTargetSchema,
  type UploadedEntry,
} from "./workspace-validation"

export const chatComposerSchema = z
  .object({
    text: z.string(),
    // Absent means no attachments: an existing draft that only carries text
    // stays valid, and callers never have to pass an empty array.
    files: z
      .array(z.instanceof(File))
      .optional()
      .transform((files) => files ?? []),
  })
  // A turn needs either words or an attachment; an empty send is refused.
  .refine(
    (value) => value.text.trim().length > 0 || value.files.length > 0,
    "Write a message or attach a file first."
  )

export type ChatComposerInput = z.input<typeof chatComposerSchema>
export type ChatComposerMessage = z.output<typeof chatComposerSchema>

export function shouldSubmitChatMessage({
  key,
  shiftKey,
  isComposing,
  keyCode,
}: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode?: number
}) {
  return key === "Enter" && !shiftKey && !isComposing && keyCode !== 229
}

// Small, model-compatible attachments fit in the chat transport. Larger files
// travel directly to workspace storage and leave a durable reference in chat.
export const INLINE_ATTACHMENT_BUDGET = 350 * 1024
const formats: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
export function attachmentMediaType(file: Pick<File, "name" | "type">) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  return Object.hasOwn(formats, extension)
    ? formats[extension]
    : Object.values(formats).includes(file.type)
      ? file.type
      : undefined
}

export function inlineAttachmentFlags(files: File[]) {
  // Leave room for base64 expansion and message metadata in Trigger's 512 KiB turn.
  let remaining = INLINE_ATTACHMENT_BUDGET
  return files.map((file) => {
    const mime = attachmentMediaType(file)
    if (
      !mime ||
      !/^(image\/|text\/|application\/(pdf|json)$)/.test(mime) ||
      file.size > remaining
    )
      return false
    remaining -= file.size
    return true
  })
}

export const storedAttachmentSchema = z.object({
  name: workspaceFileNameSchema,
  relativePath: workspaceFileTargetSchema.refine((p) =>
    p.startsWith("uploads/")
  ),
  mediaType: z.string(),
  size: z.number().int().positive(),
})
export type StoredAttachment = z.infer<typeof storedAttachmentSchema>

export async function chatAttachmentParts(
  files: File[],
  entries: UploadedEntry[],
  text: string
) {
  const parts: (TextUIPart | FileUIPart)[] = text.trim()
    ? [{ type: "text", text }]
    : []
  const workspaceFiles: Record<number, StoredAttachment> = {}
  const inline = inlineAttachmentFlags(files)
  for (const [i, file] of files.entries()) {
    const mediaType = attachmentMediaType(file)!
    const info = {
      name: file.name,
      relativePath: entries[i].relPath,
      size: file.size,
      mediaType,
    }
    workspaceFiles[parts.length] = info
    if (inline[i]) {
      parts.push({
        type: "file",
        filename: file.name,
        mediaType,
        url: await fileToDataUrl(file, mediaType),
      })
    } else {
      parts.push({
        type: "text",
        text: `Workspace attachment: ${JSON.stringify(info.relativePath)}. File contents are stored in the task workspace and are not included in this message.`,
      })
    }
  }
  return { parts, workspaceFiles }
}

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** Files the picker or a drop may accept, in the composer's own terms. */
export function attachmentRejection(file: File): string | undefined {
  const result = uploadWorkspaceFileSchema.safeParse({
    name: file.name,
    size: file.size,
  })
  if (!result.success) return result.error.issues[0].message
  if (!attachmentMediaType(file)) return "This file type cannot be attached."
  return undefined
}

function fileToDataUrl(file: File, mediaType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read the file."))
    reader.onerror = () => reject(new Error("Could not read the file."))
    reader.readAsDataURL(file.slice(0, file.size, mediaType))
  })
}
