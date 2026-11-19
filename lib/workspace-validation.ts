import { z } from "zod"

export const workspaceRootFormSchema = z.object({
  rootDir: z.string().trim().min(1, "Root directory path is required."),
})

export const WORKSPACE_ROOT_NOT_EMPTY = "Directory is not empty."

// Never trim or sanitise a name: preserve exactly what the user entered.
export const workspaceEntryNameSchema = z.string().superRefine((name, ctx) => {
  let message: string | undefined
  if (!name.trim()) message = "Enter a name."
  else if (name === "." || name === "..")
    message = 'Name cannot be "." or "..".'
  else if (/[<>:"/\\|?*]/u.test(name))
    message = 'Name cannot contain < > : " / \\ | ? *.'
  else if (
    Array.from(name).some(
      (char) =>
        char.charCodeAt(0) < 32 ||
        (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
    )
  )
    message = "Name cannot contain control characters."
  else if (/[ .]$/u.test(name))
    message = "Name cannot end with a space or period."
  else if (
    /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$) *(?:\.|$)/iu.test(
      name
    )
  )
    message =
      "This name is reserved by Windows, including with a file extension."
  else if (name.length > 255) message = "Name must be 255 characters or fewer."
  if (message) ctx.addIssue({ code: "custom", message })
})

export const workspaceDirectoryNameSchema = workspaceEntryNameSchema
export const workspaceFileNameSchema = workspaceEntryNameSchema

export const createWorkspaceFileSchema = z.object({
  name: workspaceFileNameSchema,
})

// Chat attachments are written here rather than beside the task's own files:
// they are inputs the reader supplied, and keeping them in one folder makes
// them easy to find and to clear out.
export const UPLOADS_DIR = "uploads"

// An uploaded file keeps its own name, so it is validated by the same entry
// rules as a hand-typed one. The byte limit matches what the editor can open
// and re-save, so an upload never lands in a state the workbench cannot read.
export const MAX_UPLOAD_BYTES = 256 * 1024

export const uploadWorkspaceFileSchema = z.object({
  name: workspaceFileNameSchema,
  bytes: z
    .instanceof(Uint8Array)
    .refine(
      (bytes) => bytes.byteLength > 0,
      "The selected file is empty."
    )
    .refine(
      (bytes) => bytes.byteLength <= MAX_UPLOAD_BYTES,
      "Files must be 256 KiB or smaller."
    ),
})

export const createWorkspaceDirectorySchema = z.object({
  name: workspaceDirectoryNameSchema,
})

export const workspaceRelativePathSchema = z
  .string()
  .max(4096)
  .transform((value, ctx) => {
    const relative = value.replace(/\\/g, "/")
    if (
      relative !== "" &&
      relative
        .split("/")
        .some((part) => !workspaceDirectoryNameSchema.safeParse(part).success)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "路径必须是任务内的相对路径，不能包含绝对路径、空路径段或 .、..。",
      })
      return z.NEVER
    }
    return relative
  })

export const workspaceDirectoryTargetSchema =
  workspaceRelativePathSchema.refine(
    (value) => value !== "",
    "任务根目录不可删除。"
  )

export const workspaceChatIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "无效的聊天 ID。")

export const workspaceFileTargetSchema = workspaceRelativePathSchema.refine(
  (value) => value !== "",
  "任务根目录不是文件，不能删除。"
)

export const deleteWorkspaceFileSchema = z
  .object({
    confirmed: z.literal(true),
    identity: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export type FileDeletionConfirmation = z.infer<typeof deleteWorkspaceFileSchema>
export type FileDeletionInspection = {
  relativePath: string
  name: string
  identity: string
}

// A rename keeps the entry in place and only changes its last segment, so the
// old and new names share one validation rule and one confirmation shape.
export const renameWorkspaceEntrySchema = z
  .object({
    confirmed: z.literal(true),
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    name: workspaceEntryNameSchema,
  })
  .strict()

// The dialog only edits the name; the identity is captured separately.
export const renameWorkspaceNameSchema = z.object({
  name: workspaceEntryNameSchema,
})

export type RenameWorkspaceEntryConfirmation = z.infer<
  typeof renameWorkspaceEntrySchema
>

export const deleteWorkspaceDirectorySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("empty"),
      identity: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      mode: z.literal("recursive"),
      identity: z.string().regex(/^[a-f0-9]{64}$/),
      name: workspaceDirectoryNameSchema,
    })
    .strict(),
])

export type DirectoryDeletionConfirmation = z.infer<
  typeof deleteWorkspaceDirectorySchema
>
export type DirectoryDeletionInspection = {
  relativePath: string
  name: string
  isEmpty: boolean
  identity: string
}

export interface WorkspaceEntry {
  name: string
  isDir: boolean
  // Explicitly distinguish regular files from links and other filesystem entries.
  isFile?: boolean
  relPath: string
}

export function workspaceParentPath(relativePath: string) {
  return relativePath.split("/").slice(0, -1).join("/")
}

export function isWorkspaceSubtree(relativePath: string, ancestor: string) {
  return relativePath === ancestor || relativePath.startsWith(`${ancestor}/`)
}
