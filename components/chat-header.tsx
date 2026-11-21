"use client"

import { useState } from "react"
import { PanelRightIcon } from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import { BotMemoryButton } from "@/components/bot-memory-dialog"
import { ProjectMemoryButton } from "@/components/project-memory-dialog"
import { BotName } from "@/components/bot-name"
import { TaskDialog } from "@/components/task-dialog"
import type { BotSummary } from "@/queries/bots"
import type { ChatWithBot } from "@/queries/chats"
import { ChatAvatar } from "@/components/chat-avatar"
import { compactChatAvatarStyles } from "@/components/ui/compact-styles"
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
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)

  return (
    <>
      <header className="dashboard-header justify-between gap-2 bg-background px-3 text-foreground sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <SidebarTrigger className="shrink-0 md:hidden" />
          {chat.kind === "group" ? (
            <Button
              type="button"
              variant="ghost"
              className="min-w-0 shrink justify-start"
              onClick={() => setTaskDialogOpen(true)}
            >
              <GroupChatAvatar
                bots={chat.bots}
                fallbackSeed={chat.id}
                animated
                alt={`${chat.name ?? "Task"} avatar`}
                className={compactChatAvatarStyles}
              />
              <span className="truncate">{chat.name ?? "Untitled task"}</span>
              {chat.template && (
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={chat.template.name}
                >
                  {chat.template.name} · v{chat.template.version}
                </span>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="min-w-0 shrink justify-start"
              disabled={!chat.bot}
              onClick={() => setBotDialogOpen(true)}
            >
              <ChatAvatar
                seed={chat.bot?.avatar ?? chat.id}
                animated
                alt={`${chat.bot?.name ?? chat.name ?? "Chat"} avatar`}
                className={compactChatAvatarStyles}
              />
              <BotName
                name={chat.name ?? chat.bot?.name ?? "Untitled chat"}
                job={chat.bot?.job}
              />
            </Button>
          )}
        </div>
        {chat.kind === "direct" && chat.bot && (
          <BotMemoryButton
            key={chat.id}
            chatId={chat.id}
            botName={chat.bot.name}
          />
        )}
        {chat.kind === "group" && (
          <ProjectMemoryButton key={chat.id} chatId={chat.id} />
        )}
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
              <PanelRightIcon />
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
        <TaskDialog
          key={`${chat.id}-${taskDialogOpen ? "open" : "closed"}`}
          bots={bots}
          chat={chat}
          open={taskDialogOpen}
          onOpenChange={setTaskDialogOpen}
        />
      )}
    </>
  )
}
