"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { DocumentSessionStore, type DocumentIO } from "@/lib/document-session"
import { workspaceOpenPolicy } from "@/lib/workspace-open-policy"
import {
  documentTargetSchema,
  type DocumentTarget,
} from "@/lib/workspace-document"
import {
  readWorkspaceDocumentAction,
  saveWorkspaceDocumentAction,
  openWorkspaceExternalAction,
} from "@/actions/workspace-document"
import { toast } from "@/components/ui/toast"
import { DocumentWindow } from "@/components/document-window"

const defaultIO: DocumentIO = {
  read: readWorkspaceDocumentAction,
  save: saveWorkspaceDocumentAction,
}
type Workbench = {
  session: DocumentSessionStore
  open: (target: DocumentTarget) => Promise<void>
}
const Context = createContext<Workbench | null>(null)

// Provider value never changes when editing or moving the window. Children,
// including useChat and the composer, have no subscription to document state.
export function WorkspaceDocumentProvider({
  children,
  io = defaultIO,
}: {
  children: ReactNode
  io?: DocumentIO
}) {
  const [workbench] = useState<Workbench>(() => {
    const session = new DocumentSessionStore(io)
    const launching = new Set<string>()
    return {
      session,
      open: async (raw) => {
        const parsed = documentTargetSchema.safeParse(raw)
        if (!parsed.success) return
        const target = parsed.data
        const policy = workspaceOpenPolicy(target.relativePath)
        if (policy.kind === "internal-text") {
          await session.open(target)
          return
        }
        if (policy.kind !== "external") {
          toast.add({ title: policy.reason, type: "info" })
          return
        }
        const key = `${target.chatId}/${target.relativePath}`
        if (launching.has(key)) return
        launching.add(key)
        try {
          const result = await openWorkspaceExternalAction(target)
          toast.add({
            title: result.success ? "Requested system open" : result.error,
            description: target.relativePath,
            type: result.success ? "info" : "error",
          })
        } catch {
          toast.add({
            title: "Could not request system opening.",
            type: "error",
          })
        } finally {
          setTimeout(() => launching.delete(key), 1000)
        }
      },
    }
  })
  return (
    <Context.Provider value={workbench}>
      {children}
      <DocumentWindow session={workbench.session} />
    </Context.Provider>
  )
}

export function useWorkspaceDocument() {
  const workbench = useContext(Context)
  if (!workbench) throw new Error("WorkspaceDocumentProvider is required")
  return workbench
}
