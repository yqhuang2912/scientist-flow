import { documentTargetSchema } from "@/lib/workspace-document"
import { directoryError } from "@/lib/workspace-directory.server"
import { readWorkspaceImage } from "@/lib/workspace-image.server"
import { requireWorkspaceBinding } from "@/lib/workspace.server"

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
}

const errorStatus: Record<string, number> = {
  CHAT_NOT_FOUND: 404,
  NOT_INITIALISED: 404,
  NOT_FOUND: 404,
  INACCESSIBLE: 403,
  LINK: 403,
  NOT_FILE: 400,
  CONFLICT: 409,
  UNSUPPORTED: 415,
  INVALID_IMAGE: 415,
  TOO_LARGE: 413,
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const target = documentTargetSchema.safeParse({
    ...(await params),
    relativePath: new URL(request.url).searchParams.get("path"),
  })
  if (!target.success)
    return Response.json(
      { error: "Invalid workspace image path." },
      { status: 400, headers: responseHeaders }
    )
  try {
    const { chatId, relativePath } = target.data
    const binding = await requireWorkspaceBinding(chatId)
    const { bytes, type } = await readWorkspaceImage(
      binding.taskDir,
      relativePath
    )
    return new Response(new Uint8Array(bytes), {
      headers: { ...responseHeaders, "Content-Type": type },
    })
  } catch (error) {
    const failure = directoryError(error)
    const status = errorStatus[failure.code] ?? 500
    return Response.json(
      {
        error:
          failure.code === "NOT_FOUND"
            ? "The image no longer exists."
            : failure.error,
      },
      { status, headers: responseHeaders }
    )
  }
}
