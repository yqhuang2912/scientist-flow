import { type NextRequest, NextResponse } from "next/server"
import { listWorkspaceDir } from "@/lib/workspace.server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params
  const { searchParams } = new URL(request.url)
  const relPath = searchParams.get("path") ?? ""

  try {
    const result = await listWorkspaceDir(chatId, relPath)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Distinguish not-found/not-initialised from unexpected errors
    const status =
      message.includes("not initialised") ||
      message.includes("does not exist") ||
      message.includes("Path traversal")
        ? 400
        : 500
    // Never expose stack or internal paths — just the sanitised message
    return NextResponse.json({ error: message }, { status })
  }
}
