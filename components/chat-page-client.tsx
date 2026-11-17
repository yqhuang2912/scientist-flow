"use client"

import { useState } from "react"

import { ChatHeader } from "@/components/chat-header"
import { ChatInterface } from "@/components/chat-interface"
import { ChatWorkspaceLayout } from "@/components/chat-workspace-layout"
import { SettingsDialog } from "@/components/settings-dialog"
import type { BotSummary } from "@/queries/bots"
import type { ChatWithBot } from "@/queries/chats"

interface ChatPageClientProps {
  chat: ChatWithBot
  bots: BotSummary[]
}

export function ChatPageClient({ chat, bots }: ChatPageClientProps) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Bump this to remount ResearchWorkspaceInner after config changes
  const [workspaceKey, setWorkspaceKey] = useState(0)

  return (
    <>
      <ChatWorkspaceLayout
        chatId={chat.id}
        workspaceKey={workspaceKey}
        workspaceOpen={workspaceOpen}
        onWorkspaceOpenChange={setWorkspaceOpen}
        onOpenSettings={() => setSettingsOpen(true)}
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
      <SettingsDialog
        bots={bots}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab="workspace"
        onWorkspaceSaved={() => setWorkspaceKey((k) => k + 1)}
      />
    </>
  )
}
