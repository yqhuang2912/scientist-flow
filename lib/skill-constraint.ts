export function isSkillReferenceError(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined
  return [cause, error].some(
    (value) =>
      value &&
      typeof value === "object" &&
      "code" in value &&
      (value.code === "23503" || value.code === "23001") &&
      "constraint" in value &&
      value.constraint === "bot_skills_skill_id_skills_id_fk"
  )
}
