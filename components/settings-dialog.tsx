"use client"

import { useState } from "react"
import { SettingsIcon, UsersIcon } from "lucide-react"

import { ChatAvatar } from "@/components/chat-avatar"
import { SettingsNavItem, SettingsShell } from "@/components/settings-shell"
import { WorkspaceSettingsPanel } from "@/components/workspace-settings-panel"
import { Button } from "@/components/ui/button"
import {
  compactChatAvatarStyles,
  compactItemStyles,
  compactListStyles,
} from "@/components/ui/compact-styles"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { BotSummary } from "@/queries/bots"

type SettingsTab = "bots" | "workspace"

/**
 * One settings surface for the whole app: a fixed navigation column plus a
 * single pane. The workspace pane edits the local root directory in place,
 * so changing it never opens a second dialog.
 */
export function SettingsDialog({
  bots,
  open,
  onOpenChange,
  initialTab = "bots",
  onWorkspaceSaved,
  onManageBots,
}: {
  bots: BotSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: SettingsTab
  onWorkspaceSaved?: () => void
  onManageBots?: () => void
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && initialTab !== tab) setTab(initialTab)
        onOpenChange(next)
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage bots and the workspace directory.
          </DialogDescription>
        </DialogHeader>
        <SettingsShell
          nav={
            <>
              <SettingsNavItem
                active={tab === "bots"}
                icon={<UsersIcon strokeWidth={2} />}
                onClick={() => setTab("bots")}
              >
                Bots
              </SettingsNavItem>
              <SettingsNavItem
                active={tab === "workspace"}
                icon={<SettingsIcon strokeWidth={2} />}
                onClick={() => setTab("workspace")}
              >
                Workspace
              </SettingsNavItem>
            </>
          }
        >
          {tab === "bots" ? (
            <div className="flex flex-col p-4">
              <p className="text-[13px] font-medium">Bots</p>
              <p className="text-[12px] text-muted-foreground">
                {bots.length === 0
                  ? "No bots yet."
                  : `${bots.length} bot${bots.length === 1 ? "" : "s"} available in this workspace.`}
              </p>
              <div className={cn(compactListStyles, "mt-2")}>
                {bots.map((bot) => (
                  <div
                    key={bot.id}
                    className={cn(compactItemStyles, "flex items-center")}
                  >
                    <ChatAvatar
                      seed={bot.avatar}
                      animated
                      alt={`${bot.name} avatar`}
                      className={compactChatAvatarStyles}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {bot.name}
                    </span>
                    <span
                      className="max-w-[45%] truncate text-[12px] text-muted-foreground"
                      title={bot.job}
                    >
                      {bot.job}
                    </span>
                  </div>
                ))}
              </div>
              {onManageBots && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-fit"
                  onClick={onManageBots}
                >
                  Manage bots
                </Button>
              )}
            </div>
          ) : (
            <WorkspaceSettingsPanel onSaved={onWorkspaceSaved} />
          )}
        </SettingsShell>
      </DialogContent>
    </Dialog>
  )
}
