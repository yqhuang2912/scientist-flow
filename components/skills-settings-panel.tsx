"use client"
import type { Ref } from "react"
import { BookOpenIcon } from "lucide-react"
import { deleteSkill } from "@/actions/skill"
import { getSkill, getSkills } from "@/queries/skills"
import { skillPath } from "@/lib/skill-definition"
import { DocumentMarkdown } from "@/components/document-markdown"
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
      getEntry={getSkill}
      removeEntry={deleteSkill}
      identifier={(skill) => skillPath(skill.name)}
      renderDetail={(skill) => (
        <DocumentMarkdown content={skill.instructions} />
      )}
      renderForm={(skill, onSaved, onCancel) => (
        <SkillForm
          skill={skill}
          guard={guard}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
    />
  )
}
