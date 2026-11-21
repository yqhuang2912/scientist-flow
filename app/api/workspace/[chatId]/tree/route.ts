import { type NextRequest, NextResponse } from "next/server"
import {
  listWorkspaceDir,
  requireWorkspaceBinding,
} from "@/lib/workspace.server"
import { findWorkspaceMentions } from "@/lib/workspace-mentions.server"
import { directoryError } from "@/lib/workspace-directory.server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params
  const { searchParams } = new URL(request.url)
  const relPath = searchParams.get("path") ?? ""

  try {
    const query = searchParams.get("mention")
    const result =
      query === null
        ? await listWorkspaceDir(chatId, relPath)
        : await findWorkspaceMentions(
            (await requireWorkspaceBinding(chatId)).taskDir,
            query,
            request.signal
          )
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err) {
    const failure = directoryError(err)
    return NextResponse.json(failure, {
      status: failure.code === "IO_ERROR" ? 500 : 400,
      headers: { "Cache-Control": "no-store" },
    })
  }
}
