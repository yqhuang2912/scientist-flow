"use client"

import { useEffect, useState } from "react"

import { ChatHeader } from "@/components/chat-header"
import { ChatInterface } from "@/components/chat-interface"
import { ChatWorkspaceLayout } from "@/components/chat-workspace-layout"
import type { BotSummary } from "@/queries/bots"
import type { ChatWithBot } from "@/queries/chats"

interface ChatPageClientProps {
  chat: ChatWithBot
  bots: BotSummary[]
}

export function ChatPageClient({ chat, bots }: ChatPageClientProps) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  // Bump this to remount ResearchWorkspaceInner after config changes
  const [workspaceKey, setWorkspaceKey] = useState(0)
  useEffect(() => {
    const refreshWorkspace = () => setWorkspaceKey((key) => key + 1)
    window.addEventListener(
      "scientistflow:workspace-root-changed",
      refreshWorkspace
    )
    return () =>
      window.removeEventListener(
        "scientistflow:workspace-root-changed",
        refreshWorkspace
      )
  }, [])

  return (
    <ChatWorkspaceLayout
      chatId={chat.id}
      workspaceKey={workspaceKey}
      workspaceOpen={workspaceOpen}
      onWorkspaceOpenChange={setWorkspaceOpen}
      onOpenSettings={() =>
        window.dispatchEvent(new Event("scientistflow:manage-general"))
      }
    >
      <ChatHeader
        chat={chat}
        bots={bots}
        workspaceOpen={workspaceOpen}
        onWorkspaceOpenChange={setWorkspaceOpen}
      />
      <ChatInterface
        chatId={chat.id}
        bots={chat.bots}
        isGroup={chat.kind === "group"}
      />
    </ChatWorkspaceLayout>
  )
}
