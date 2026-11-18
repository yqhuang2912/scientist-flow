"use client"
import { type Ref } from "react"
import { BookOpenIcon } from "lucide-react"
import { getSkills } from "@/queries/skills"
import { SkillForm } from "@/components/skill-form"
import { SharedLibraryPanel } from "@/components/shared-library-panel"
import type { SettingsLeaveGuard } from "@/components/settings-form-guard"

export function SkillsSettingsPanel({
  guard,
}: {
  guard: Ref<SettingsLeaveGuard>
}) {
  return (
    <SharedLibraryPanel
      noun="skill"
      title="Skills"
      description="Create shared skills for your bots."
      icon={<BookOpenIcon />}
      getList={getSkills}
      renderForm={(skill, onCancel) => (
        <SkillForm skill={skill} guard={guard} onCancel={onCancel} />
      )}
    />
  )
}
