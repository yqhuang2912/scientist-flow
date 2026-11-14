"use client"

import { useState } from "react"
import { MonitorIcon } from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import type { ChatWithBot } from "@/queries/chats"
import { ChatAvatar } from "@/components/chat-avatar"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { Button } from "@/components/ui/button"

export function ChatHeader({ chat }: { chat: ChatWithBot }) {
  const [botDialogOpen, setBotDialogOpen] = useState(false)

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4 text-foreground">
        {chat.kind === "group" ? (
          <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
            <GroupChatAvatar
              bots={chat.bots}
              fallbackSeed={chat.id}
              animated
              alt={`${chat.name ?? "Group chat"} avatar`}
              className="size-8 rounded-lg"
            />
            <span className="truncate text-sm font-medium">
              {chat.name ?? "Untitled group chat"}
            </span>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-w-0 justify-start gap-2 px-2 py-1.5"
            disabled={!chat.bot}
            onClick={() => setBotDialogOpen(true)}
          >
            <ChatAvatar
              seed={chat.bot?.avatar ?? chat.id}
              animated
              alt={`${chat.bot?.name ?? chat.name ?? "Chat"} avatar`}
              className="size-8 rounded-lg"
            />
            <span className="truncate text-sm font-medium">
              {chat.name ?? chat.bot?.name ?? "Untitled chat"}
            </span>
          </Button>
        )}
        {chat.kind === "direct" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Desktop app"
          >
            <MonitorIcon />
          </Button>
        )}
      </header>
      {chat.kind === "direct" && chat.bot && (
        <BotDialog
          bot={chat.bot}
          initialAvatarSeed={chat.bot.avatar}
          open={botDialogOpen}
          onOpenChange={setBotDialogOpen}
          showTrigger={false}
        />
      )}
    </>
  )
}
