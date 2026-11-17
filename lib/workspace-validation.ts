import { z } from "zod"

// Never trim or sanitise a name: preserve exactly what the user entered.
export const workspaceEntryNameSchema = z.string().superRefine((name, ctx) => {
  let message: string | undefined
  if (!name.trim()) message = "请输入名称。"
  else if (name === "." || name === "..") message = "名称不能是 . 或 ..。"
  else if (/[<>:"/\\|?*]/u.test(name))
    message = '名称不能包含路径分隔符或 Windows 非法字符：< > : " / \\ | ? *。'
  else if (
    Array.from(name).some(
      (char) =>
        char.charCodeAt(0) < 32 ||
        (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
    )
  )
    message = "名称不能包含控制字符。"
  else if (/[ .]$/u.test(name)) message = "名称不能以空格或点结尾。"
  else if (
    /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$) *(?:\.|$)/iu.test(
      name
    )
  )
    message = "不能使用 Windows 保留名称（包括带扩展名的保留名称）。"
  else if (name.length > 255) message = "名称不能超过 255 个字符。"
  if (message) ctx.addIssue({ code: "custom", message })
})

export const workspaceDirectoryNameSchema = workspaceEntryNameSchema
export const workspaceFileNameSchema = workspaceEntryNameSchema

export const createWorkspaceFileSchema = z.object({
  name: workspaceFileNameSchema,
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
