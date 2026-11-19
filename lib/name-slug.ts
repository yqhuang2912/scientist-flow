const maxLength = 64

/**
 * Derive a skill identifier (`a-b-c`) from a human name. Returns an empty
 * string when the name has no ASCII letters or digits, as with 中文, so the
 * form can leave the identifier for the user instead of inventing one.
 */
export function skillSlug(name: string) {
  return base(name, "-")
}

/**
 * Derive a tool identifier (`a_b_c`) from a human name. Tool names are model
 * function names, so they must start with a letter and use underscores.
 */
export function toolSlug(name: string) {
  const slug = base(name, "_")
  if (!slug) return ""
  return /^[a-z]/.test(slug) ? slug : `tool_${slug}`.slice(0, maxLength)
}

function base(name: string, separator: "-" | "_") {
  const slug = name
    // NFKD separates accents from their base letter, then the filter drops
    // the combining marks so "Café" becomes "cafe".
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "")

  // Trimming to the limit can leave a trailing separator, which the
  // identifier rules reject.
  return slug
    .slice(0, maxLength)
    .replace(new RegExp(`\\${separator}+$`), "")
}
