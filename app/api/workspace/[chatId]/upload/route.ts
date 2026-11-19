import { fileError } from "@/lib/workspace-file.server"
import { uploadWorkspaceFile } from "@/lib/workspace.server"
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_SIZE_ERROR,
  uploadWorkspaceFileSchema,
  workspaceChatIdSchema,
  workspaceRelativePathSchema,
} from "@/lib/workspace-validation"

function failure(error: string, status: number) {
  return Response.json({ error }, { status })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const url = new URL(request.url)
  const origin = request.headers.get("origin")
  const host = request.headers.get("host")
  if (origin && origin !== `${url.protocol}//${host}`)
    return failure("Cross-origin uploads are not allowed.", 403)
  if (request.headers.get("content-type") !== "application/octet-stream")
    return failure("Send the file as a binary upload.", 415)
  const chat = workspaceChatIdSchema.safeParse((await params).chatId)
  const parent = workspaceRelativePathSchema.safeParse(
    url.searchParams.get("parent") ?? ""
  )
  if (!chat.success || !parent.success)
    return failure("Invalid upload destination.", 400)
  const size = Number(url.searchParams.get("size"))
  const length = request.headers.get("content-length")
  if (
    size > MAX_UPLOAD_BYTES ||
    (length !== null && Number(length) > MAX_UPLOAD_BYTES)
  )
    return failure(UPLOAD_SIZE_ERROR, 413)
  const input = uploadWorkspaceFileSchema.safeParse({
    name: url.searchParams.get("name"),
    size,
  })
  if (!input.success) return failure(input.error.issues[0].message, 400)
  if (!request.body || (length !== null && Number(length) !== size))
    return failure("Upload length does not match the selected file.", 400)
  try {
    const entry = await uploadWorkspaceFile(
      chat.data,
      parent.data,
      input.data,
      request.body,
      url.searchParams.get("attachment") === "1"
    )
    return Response.json({ entry }, { status: 201 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOSPC")
      return failure("The workspace disk is full.", 507)
    const problem = fileError(error)
    const statuses: Record<string, number> = {
      TOO_LARGE: 413,
      INVALID: 400,
      CONFLICT: 409,
      CHANGED: 409,
      NOT_INITIALISED: 409,
      NOT_FOUND: 404,
      CHAT_NOT_FOUND: 404,
      LINK: 403,
      UNSAFE_PATH: 403,
      INACCESSIBLE: 403,
    }
    return failure(
      problem.code === "CONFLICT"
        ? "A file or folder with this name already exists."
        : problem.error,
      statuses[problem.code] ?? 500
    )
  }
}
