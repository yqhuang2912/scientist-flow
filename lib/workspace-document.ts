import { z } from "zod"
import {
  workspaceChatIdSchema,
  workspaceFileTargetSchema,
} from "./workspace-validation"

export const MAX_DOCUMENT_BYTES = 256 * 1024
export const documentTargetSchema = z
  .object({
    chatId: workspaceChatIdSchema,
    relativePath: workspaceFileTargetSchema,
  })
  .strict()
export const saveDocumentSchema = documentTargetSchema
  .extend({
    content: z
      .string()
      .max(MAX_DOCUMENT_BYTES)
      .refine(
        (text) =>
          new TextEncoder().encode(text).byteLength <= MAX_DOCUMENT_BYTES,
        "Text exceeds the 256 KiB limit."
      ),
    baseVersion: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export type DocumentTarget = z.infer<typeof documentTargetSchema>
export type SaveDocumentInput = z.infer<typeof saveDocumentSchema>
export type TextDocument = {
  content: string
  version: string
  bom: boolean
  newline: "LF" | "CRLF" | "CR" | "mixed"
}
export type DocumentFailure = { success: false; code: string; error: string }
export type DocumentResult<T> = { success: true; data: T } | DocumentFailure
export type OpenedDocument = TextDocument &
  DocumentTarget & { taskName: string }

export function sameDocument(a: DocumentTarget, b: DocumentTarget) {
  // Workspace names follow the host Windows semantics. Server paths are canonicalized.
  return a.chatId === b.chatId && a.relativePath === b.relativePath
}
