import { type NextRequest, NextResponse } from "next/server"
import { listWorkspaceDir } from "@/lib/workspace.server"
import { directoryError } from "@/lib/workspace-directory.server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params
  const { searchParams } = new URL(request.url)
  const relPath = searchParams.get("path") ?? ""

  try {
    const result = await listWorkspaceDir(chatId, relPath)
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
