import { stringify } from "yaml"
import { skillFormSchema, skillNameSchema, type SkillValues } from "@/db/schema"

export type SkillResult<T> =
  { success: true; data: T } | { success: false; error: string }

export function skillPath(name: string) {
  return `/skills/${skillNameSchema.parse(name)}/SKILL.md`
}

export function serializeSkillToMarkdown(
  definition: Pick<SkillValues, "name" | "description" | "instructions">
) {
  const { name, description, instructions } = skillFormSchema.parse({
    name: definition.name,
    description: definition.description,
    instructions: definition.instructions,
  })
  const header = stringify({ name, description }, { lineWidth: 0 })
  return `---\n${header}---\n\n${instructions}`
}
