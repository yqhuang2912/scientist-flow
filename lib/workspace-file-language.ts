import type { BundledLanguage } from "shiki"

/**
 * Maps a workspace file to the Shiki grammar that highlights it.
 *
 * Only extensions that `workspaceOpenPolicy` already admits as text appear
 * here; anything else falls back to plain text, which renders unhighlighted
 * rather than failing. Keep this aligned with TEXT_EXTENSIONS in
 * `lib/workspace-open-policy.ts`.
 */
const EXTENSION_LANGUAGES: Record<string, BundledLanguage> = {
  md: "markdown",
  markdown: "markdown",
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  tex: "latex",
  bib: "bibtex",
  xml: "xml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  config: "ini",
  sh: "shellscript",
  r: "r",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  sql: "sql",
}

/**
 * Files whose name carries the format instead of an extension. Matched on the
 * lowercased basename, so `Dockerfile` and `dockerfile` both resolve.
 */
const FILENAME_LANGUAGES: Record<string, BundledLanguage> = {
  dockerfile: "docker",
  makefile: "make",
  ".gitignore": "ini",
  ".env": "ini",
  ".editorconfig": "ini",
}

/** The grammar for a path, or "text" when nothing matches. */
export function workspaceFileLanguage(
  relativePath: string
): BundledLanguage | "text" {
  const name = relativePath.split("/").at(-1)?.toLowerCase() ?? ""
  const byName = FILENAME_LANGUAGES[name]
  if (byName) return byName
  // Take the last segment so `archive.tar.gz` resolves on `gz`, not `tar`.
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "") : ""
  return EXTENSION_LANGUAGES[extension] ?? "text"
}

/** The label shown in the preview header. */
export function workspaceLanguageLabel(
  language: BundledLanguage | "text"
): string {
  const labels: Record<string, string> = {
    tsx: "TSX",
    jsx: "JSX",
    typescript: "TypeScript",
    javascript: "JavaScript",
    json: "JSON",
    jsonc: "JSONC",
    yaml: "YAML",
    toml: "TOML",
    css: "CSS",
    scss: "SCSS",
    html: "HTML",
    xml: "XML",
    sql: "SQL",
    ini: "INI",
    latex: "LaTeX",
    bibtex: "BibTeX",
    shellscript: "Shell",
    cpp: "C++",
    c: "C",
    r: "R",
    go: "Go",
    rust: "Rust",
    java: "Java",
    python: "Python",
    markdown: "Markdown",
    docker: "Dockerfile",
    make: "Makefile",
    text: "Plain text",
  }
  return labels[language] ?? language
}
