import { z } from "zod"

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

// The composer holds a File object per attachment; the transcript and the
// model only ever see a URL and media type.
export const ACCEPTED_UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Files the picker or a drop may accept, in the composer's own terms. */
export function attachmentRejection(file: File): string | undefined {
  if (file.size === 0) return "This file is empty."
  if (file.size > MAX_ATTACHMENT_BYTES)
    return `Files must be ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)} or smaller.`
  if (file.type && !ACCEPTED_UPLOAD_TYPES.includes(file.type))
    return "This file type cannot be attached."
  return undefined
}

/**
 * A file part carries a URL, and the browser holds the bytes. Converting here
 * keeps the whole attachment in the message the user sends; nothing is written
 * to disk, so an attachment never lands in the task workspace unasked.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read the file."))
    reader.onerror = () => reject(new Error("Could not read the file."))
    reader.readAsDataURL(file)
  })
}
