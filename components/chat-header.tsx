"use client"

import { useState } from "react"
import { PanelRightIcon } from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import { GroupChatDialog } from "@/components/group-chat-dialog"
import type { BotSummary } from "@/queries/bots"
import type { ChatWithBot } from "@/queries/chats"
import { ChatAvatar } from "@/components/chat-avatar"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function ChatHeader({
  chat,
  bots,
  workspaceOpen,
  onWorkspaceOpenChange,
}: {
  chat: ChatWithBot
  bots: BotSummary[]
  workspaceOpen?: boolean
  onWorkspaceOpenChange?: (open: boolean) => void
}) {
  const [botDialogOpen, setBotDialogOpen] = useState(false)
  const [groupChatDialogOpen, setGroupChatDialogOpen] = useState(false)

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 text-foreground sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <SidebarTrigger className="shrink-0 md:hidden" />
          {chat.kind === "group" ? (
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 justify-start gap-2 px-2 py-1.5"
              onClick={() => setGroupChatDialogOpen(true)}
            >
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
            </Button>
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
        </div>
        {onWorkspaceOpenChange && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    workspaceOpen ? "Close workspace" : "Open workspace"
                  }
                  aria-expanded={workspaceOpen}
                  aria-controls="workspace-panel"
                  data-workspace-toggle
                  onClick={() => onWorkspaceOpenChange(!workspaceOpen)}
                  className={cn(
                    "shrink-0",
                    workspaceOpen && "bg-accent text-accent-foreground"
                  )}
                />
              }
            >
              <PanelRightIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>
              {workspaceOpen ? "Close workspace" : "Open workspace"}
            </TooltipContent>
          </Tooltip>
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
      {chat.kind === "group" && (
        <GroupChatDialog
          bots={bots}
          chat={chat}
          open={groupChatDialogOpen}
          onOpenChange={setGroupChatDialogOpen}
        />
      )}
    </>
  )
}
