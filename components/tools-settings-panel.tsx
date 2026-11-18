"use client"

import { WrenchIcon } from "lucide-react"
import type { Ref } from "react"
import { getTools } from "@/queries/tools"
import type { SettingsLeaveGuard } from "@/components/settings-form-guard"
import { SharedLibraryPanel } from "@/components/shared-library-panel"
import { ToolForm } from "@/components/tool-form"

export function ToolsSettingsPanel({
  guard,
}: {
  guard: Ref<SettingsLeaveGuard>
}) {
  return (
    <SharedLibraryPanel
      noun="tool"
      title="Tools"
      description="Manage shared tool definitions for your bots."
      icon={<WrenchIcon />}
      getList={getTools}
      renderForm={(tool, onCancel) => (
        <ToolForm tool={tool} guard={guard} onCancel={onCancel} />
      )}
    />
  )
}
