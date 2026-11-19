"use client"

import { useState, type Ref } from "react"
import { UsersIcon } from "lucide-react"
import { BotForm } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import type { SettingsLeaveGuard } from "@/components/settings-form-guard"
import { SettingsList, SettingsListHeader } from "@/components/settings-list"
import { SettingsPane, SettingsEditorPane } from "@/components/settings-shell"
import { compactChatAvatarStyles } from "@/components/ui/compact-styles"
import type { BotSummary } from "@/queries/bots"

export function BotsSettingsPanel({
  bots,
  guard,
  onManageLibrary,
}: {
  bots: BotSummary[]
  guard: Ref<SettingsLeaveGuard>
  onManageLibrary: (tab: "skills" | "tools" | "connections") => void
}) {
  const [search, setSearch] = useState("")
  const [editor, setEditor] = useState<{ bot?: BotSummary } | null>(null)
  if (editor) {
    return (
      <SettingsEditorPane label="Bots">
        <BotForm
          key={editor.bot?.id ?? "new"}
          bot={editor.bot}
          guard={guard}
          onManageLibrary={onManageLibrary}
          onClose={() => setEditor(null)}
        />
      </SettingsEditorPane>
    )
  }
  const query = search.trim().toLowerCase()
  const matches = bots.filter((bot) =>
    [bot.name, bot.job].some((value) => value.toLowerCase().includes(query))
  )
  return (
    <SettingsPane aria-label="Bots" className="gap-3">
      <SettingsListHeader
        title="Bots"
        description="Manage bots in this workspace."
        noun="bot"
        search={search}
        onSearch={setSearch}
        onCreate={() => setEditor({})}
      />
      <SettingsList
        items={matches.map((bot) => ({
          id: bot.id,
          name: bot.name,
          description: bot.modelChoice
            ? bot.job
            : bot.job + " · Needs configuration",
          icon: (
            <ChatAvatar
              seed={bot.avatar}
              animated
              alt=""
              className={compactChatAvatarStyles}
            />
          ),
          onSelect: () => setEditor({ bot }),
        }))}
        icon={<UsersIcon />}
        emptyLabel={bots.length ? "No matching bots" : "No bots yet"}
      />
    </SettingsPane>
  )
}
