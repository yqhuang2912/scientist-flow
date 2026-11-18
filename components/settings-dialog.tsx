"use client"

import { useRef, useState } from "react"
import {
  BookOpenIcon,
  FolderIcon,
  SettingsIcon,
  WrenchIcon,
  UsersIcon,
} from "lucide-react"

import { ChatAvatar } from "@/components/chat-avatar"
import { GeneralSettingsPanel } from "@/components/general-settings-panel"
import { SettingsNavItem, SettingsShell } from "@/components/settings-shell"
import { SkillsSettingsPanel } from "@/components/skills-settings-panel"
import type { SettingsLeaveGuard } from "@/components/settings-form-guard"
import { ToolsSettingsPanel } from "@/components/tools-settings-panel"
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

type SettingsTab = "general" | "bots" | "skills" | "tools" | "workspace"

/**
 * One settings surface for the whole app: a fixed navigation column plus a
 * single pane. The workspace pane edits the local root directory in place,
 * so changing it never opens a second dialog.
 */
export function SettingsDialog({
  bots,
  open,
  onOpenChange,
  initialTab = "general",
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
  const leaveGuard = useRef<SettingsLeaveGuard>(null)
  const libraryTab = tab === "skills" || tab === "tools"

  function selectTab(next: SettingsTab) {
    if (next === tab) return
    if (leaveGuard.current) leaveGuard.current(() => setTab(next))
    else setTab(next)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, event) => {
        if (!next && leaveGuard.current) {
          event.cancel()
          leaveGuard.current(() => onOpenChange(false))
          return
        }
        if (next && initialTab !== tab) setTab(initialTab)
        onOpenChange(next)
      }}
    >
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden p-0 sm:max-w-xl",
          libraryTab && "sm:max-w-2xl"
        )}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage appearance, bots, shared skills, tools and the workspace
            directory.
          </DialogDescription>
        </DialogHeader>
        <SettingsShell
          className={
            libraryTab
              ? "max-h-[calc(100dvh-2rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)] sm:min-h-[min(24rem,calc(100dvh-2rem))] sm:grid-rows-1 [&>div]:min-h-0 [&>div]:overflow-y-auto"
              : undefined
          }
          nav={
            <>
              <SettingsNavItem
                active={tab === "general"}
                icon={<SettingsIcon strokeWidth={2} />}
                onClick={() => selectTab("general")}
              >
                General
              </SettingsNavItem>
              <SettingsNavItem
                active={tab === "bots"}
                icon={<UsersIcon strokeWidth={2} />}
                onClick={() => selectTab("bots")}
              >
                Bots
              </SettingsNavItem>
              <SettingsNavItem
                active={tab === "skills"}
                icon={<BookOpenIcon />}
                onClick={() => selectTab("skills")}
              >
                Skills
              </SettingsNavItem>
              <SettingsNavItem
                active={tab === "tools"}
                icon={<WrenchIcon />}
                onClick={() => selectTab("tools")}
              >
                Tools
              </SettingsNavItem>
              <SettingsNavItem
                active={tab === "workspace"}
                icon={<FolderIcon strokeWidth={2} />}
                onClick={() => selectTab("workspace")}
              >
                Workspace
              </SettingsNavItem>
            </>
          }
        >
          {tab === "general" ? (
            <GeneralSettingsPanel />
          ) : tab === "skills" ? (
            open && <SkillsSettingsPanel guard={leaveGuard} />
          ) : tab === "tools" ? (
            open && <ToolsSettingsPanel guard={leaveGuard} />
          ) : tab === "bots" ? (
            <div className="flex flex-col p-4">
              <p className="type-section-title">Bots</p>
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
                    <span className="min-w-0 flex-1 truncate type-control">
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
