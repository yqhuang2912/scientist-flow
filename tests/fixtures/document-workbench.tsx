"use client"

// Mount temporarily in a development-only route; no model or experiment runs.
import { useEffect, useState } from "react"
import ChatUIFixture from "./chat-ui"
import {
  WorkspaceDocumentProvider,
  useWorkspaceDocument,
} from "@/components/workspace-document-provider"
import { Button } from "@/components/ui/button"

function Probe({
  chatId,
  relativePath,
}: {
  chatId: string
  relativePath: string
}) {
  const { open } = useWorkspaceDocument()
  const [mounts, setMounts] = useState(0)
  useEffect(() => {
    // Deliberate lifecycle probe; Strict Mode may mount twice initially.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounts((value) => value + 1)
  }, [])
  return (
    <div className="flex items-center gap-3 border-b p-2 text-xs">
      <Button onClick={() => void open({ chatId, relativePath })}>
        Open sample document
      </Button>
      <span>Chat container mounts: {mounts}</span>
    </div>
  )
}
export default function DocumentWorkbenchFixture(props: {
  chatId: string
  relativePath: string
}) {
  return (
    <WorkspaceDocumentProvider>
      <div className="flex h-svh flex-col">
        <Probe {...props} />
        <div className="min-h-0 flex-1">
          <ChatUIFixture />
        </div>
      </div>
    </WorkspaceDocumentProvider>
  )
}
