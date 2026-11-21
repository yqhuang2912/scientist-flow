import { z } from "zod"
import type { FileUIPart, TextUIPart, UIMessage } from "ai"
import { chatAttachmentFormat } from "./chat-attachment-format"
import { workspaceOpenPolicy } from "./workspace-open-policy"
import {
  uploadWorkspaceFileSchema,
  MAX_UPLOAD_BYTES,
  workspaceFileNameSchema,
  workspaceFileTargetSchema,
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
export type ChatComposerDraft = z.output<typeof chatComposerSchema>
export type ChatComposerMessage = ChatComposerDraft & {
  mentionedBotIds: string[]
  workspacePaths: string[]
}

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

const MAX_RECOVERED_ATTACHMENTS = 8

export function attachmentMediaType(file: Pick<File, "name" | "type">) {
  return chatAttachmentFormat(file.name, file.type)?.mediaType
}

export const storedAttachmentSchema = z.object({
  name: workspaceFileNameSchema,
  relativePath: workspaceFileTargetSchema.refine(
    (p) => p.startsWith("uploads/") && p.split("/").length === 2
  ),
  mediaType: z.string().max(160),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  contextOnly: z.boolean().optional(),
})
export type StoredAttachment = z.infer<typeof storedAttachmentSchema>
export function workspaceMentionMediaType(relativePath: string) {
  const policy = workspaceOpenPolicy(relativePath)
  if (policy.kind === "blocked" || policy.kind === "unsupported")
    return undefined
  const format = chatAttachmentFormat(relativePath)
  if (
    format &&
    format.reader !== "legacy-office" &&
    format.reader !== "preview-image"
  )
    return format.mediaType
}
export const messageAttachmentSchema = z.union([
  storedAttachmentSchema.extend({
    origin: z.literal("workspace"),
    relativePath: workspaceFileTargetSchema.refine(
      (p) => !!workspaceMentionMediaType(p)
    ),
    size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  }),
  storedAttachmentSchema,
])
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>
export type PreparedAttachment = {
  reference: MessageAttachment
  part: TextUIPart | FileUIPart
}

export function legacyAttachmentReferences(
  messages: UIMessage[],
  current: StoredAttachment[]
) {
  const seen = new Set(current.map((r) => r.relativePath))
  const missing: StoredAttachment[] = []
  for (
    let i = messages.length - 1;
    i >= 0 && missing.length + current.length < MAX_RECOVERED_ATTACHMENTS;
    i--
  ) {
    const message = messages[i]
    const refs = (
      message.metadata as
        { workspaceFiles?: Record<string, unknown> } | undefined
    )?.workspaceFiles
    if (message.role !== "user" || !refs) continue
    for (const [idx, part] of message.parts.entries()) {
      const ref = storedAttachmentSchema.safeParse(refs[idx]).data
      if (!ref || seen.has(ref.relativePath)) continue
      seen.add(ref.relativePath)
      const marker = "Workspace attachment: " + JSON.stringify(ref.relativePath)
      if (
        part.type === "text" &&
        (part.text === marker ||
          part.text ===
            marker +
              ". File contents are stored in the task workspace and are not included in this message.")
      ) {
        missing.push({ ...ref, contextOnly: true })
        if (missing.length + current.length === MAX_RECOVERED_ATTACHMENTS) break
      }
    }
  }
  return missing
}

export function chatAttachmentParts(files: PreparedAttachment[], text: string) {
  const parts: (TextUIPart | FileUIPart)[] = text.trim()
    ? [{ type: "text", text }]
    : []
  const workspaceFiles: Record<number, MessageAttachment> = {}
  for (const { reference, part } of files) {
    workspaceFiles[parts.length] = reference
    parts.push(part)
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
