"use client"

import { useRef, useState } from "react"
import { BookOpenIcon, CableIcon, WorkflowIcon, SettingsIcon, WrenchIcon, UsersIcon } from "lucide-react"
import { ModelConnectionsPanel } from "./model-connections-panel"

import { BotsSettingsPanel } from "@/components/bots-settings-panel"
import { GeneralSettingsPanel } from "@/components/general-settings-panel"
import {
  SettingsDialogContent,
  SettingsNavItem,
  SettingsShell,
} from "@/components/settings-shell"
import { SkillsSettingsPanel } from "@/components/skills-settings-panel"
import type { SettingsLeaveGuard } from "@/components/settings-form-guard"
import { ToolsSettingsPanel } from "@/components/tools-settings-panel"
import { TemplatesSettingsPanel } from "@/components/templates-settings-panel"
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { BotSummary } from "@/queries/bots"

type SettingsTab = "general" | "bots" | "skills" | "tools" | "templates" | "connections"

export function SettingsDialog({
  bots,
  open,
  onOpenChange,
  initialTab = "general",
  onWorkspaceSaved,
}: {
  bots: BotSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: SettingsTab
  onWorkspaceSaved?: () => void
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const leaveGuard = useRef<SettingsLeaveGuard>(null)

  function selectTab(next: SettingsTab) {
    if (next === tab) return
    if (leaveGuard.current) leaveGuard.current(() => setTab(next))
    else setTab(next)
  }

  return (
    <Dialog
      open={open}
      onOpenChangeComplete={(visible) => {
        if (!visible) setTab(initialTab)
      }}
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
      <SettingsDialogContent>
        <DialogHeader className="justify-center border-b px-4 py-3 pr-12">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Manage appearance, bots, shared skills, tools, templates and the workspace
            directory.
          </DialogDescription>
        </DialogHeader>
        <SettingsShell
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
              <SettingsNavItem active={tab==="connections"} icon={<CableIcon/>} onClick={()=>selectTab("connections")}>Models</SettingsNavItem>
              <SettingsNavItem
                active={tab === "templates"}
                icon={<WorkflowIcon />}
                onClick={() => selectTab("templates")}
              >
                Templates
              </SettingsNavItem>
            </>
          }
        >
          {tab === "general" ? (
            <GeneralSettingsPanel onWorkspaceSaved={onWorkspaceSaved} />
          ) : tab === "connections" ? (
            open && <ModelConnectionsPanel guard={leaveGuard}/>
          ) : tab === "skills" ? (
            open && <SkillsSettingsPanel guard={leaveGuard} />
          ) : tab === "tools" ? (
            open && <ToolsSettingsPanel guard={leaveGuard} />
          ) : tab === "templates" ? (
            open && <TemplatesSettingsPanel guard={leaveGuard} />
          ) : (
            open && (
              <BotsSettingsPanel
                bots={bots}
                guard={leaveGuard}
                onManageLibrary={setTab}
              />
            )
          )}
        </SettingsShell>
      </SettingsDialogContent>
    </Dialog>
  )
}
