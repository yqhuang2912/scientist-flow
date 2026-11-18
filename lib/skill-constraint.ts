function isReferenceError(error: unknown, constraint: string) {
  const cause = error instanceof Error ? error.cause : undefined
  return [cause, error].some(
    (value) =>
      value &&
      typeof value === "object" &&
      "code" in value &&
      (value.code === "23503" || value.code === "23001") &&
      "constraint" in value &&
      value.constraint === constraint
  )
}
export const isSkillReferenceError = (error: unknown) =>
  isReferenceError(error, "bot_skills_skill_id_skills_id_fk")
export const isToolReferenceError = (error: unknown) =>
  isReferenceError(error, "bot_tools_tool_id_tools_id_fk")
