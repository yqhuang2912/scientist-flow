import assert from "node:assert/strict"
import { test } from "node:test"
import {
  workspaceFileLanguage,
  workspaceLanguageLabel,
} from "../lib/workspace-file-language"
import { workspaceOpenPolicy } from "../lib/workspace-open-policy"

test("every text extension the open policy admits resolves to a grammar", () => {
  // Plain prose and logs have no grammar on purpose; everything else the
  // policy opens as text must highlight, or the preview silently shows
  // unstyled source.
  const plain = new Set([".txt", ".log"])
  const extensions = [
    ".md",
    ".markdown",
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".toml",
    ".css",
    ".scss",
    ".html",
    ".htm",
    ".tex",
    ".bib",
    ".xml",
    ".ini",
    ".cfg",
    ".conf",
    ".config",
    ".sh",
    ".r",
    ".rs",
    ".go",
    ".java",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".sql",
    ".txt",
    ".log",
  ]
  for (const extension of extensions) {
    const path = `notes/file${extension}`
    assert.equal(
      workspaceOpenPolicy(path).kind,
      "internal-text",
      `${extension} should open as text`
    )
    const language = workspaceFileLanguage(path)
    if (plain.has(extension))
      assert.equal(language, "text", `${extension} should stay plain`)
    else
      assert.notEqual(language, "text", `${extension} should have a grammar`)
  }
})

test("language resolves from the last extension and is case-insensitive", () => {
  assert.equal(workspaceFileLanguage("src/Main.PY"), "python")
  assert.equal(workspaceFileLanguage("a/b/c/app.component.tsx"), "tsx")
  assert.equal(workspaceFileLanguage("archive.tar.gz"), "text")
  assert.equal(workspaceFileLanguage("README"), "text")
})

test("extensionless build files resolve by name", () => {
  assert.equal(workspaceFileLanguage("Dockerfile"), "docker")
  assert.equal(workspaceFileLanguage("build/makefile"), "make")
  assert.equal(workspaceFileLanguage(".gitignore"), "ini")
})

test("labels are human-readable and never empty", () => {
  assert.equal(workspaceLanguageLabel("typescript"), "TypeScript")
  assert.equal(workspaceLanguageLabel("cpp"), "C++")
  assert.equal(workspaceLanguageLabel("text"), "Plain text")
  assert.equal(workspaceLanguageLabel("shellscript"), "Shell")
})
