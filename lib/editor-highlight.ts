import { HighlightStyle } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"

/**
 * Editor highlighting that matches the Shiki `github-light` / `github-dark`
 * themes already used by the chat transcript and the code blocks inside a
 * markdown preview.
 *
 * CodeMirror highlights through Lezer tags rather than a TextMate grammar, so
 * the two systems cannot share a theme file. Colors are therefore taken from
 * the GitHub themes by hand and declared as CSS variables, which the editor's
 * own stylesheet switches between light and dark. Keeping them in variables
 * means a single rendered stylesheet serves both themes, so toggling the theme
 * does not have to rebuild the editor.
 */
export const editorHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword], color: "var(--cm-keyword)" },
  { tag: [t.controlKeyword, t.operatorKeyword], color: "var(--cm-keyword)" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "var(--cm-text)" },
  { tag: [t.propertyName], color: "var(--cm-property)" },
  { tag: [t.function(t.variableName), t.labelName], color: "var(--cm-function)" },
  { tag: [t.definition(t.variableName)], color: "var(--cm-variable)" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "var(--cm-constant)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--cm-type)" },
  { tag: [t.number, t.bool, t.null], color: "var(--cm-constant)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--cm-string)" },
  { tag: [t.escape], color: "var(--cm-constant)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: [t.meta, t.documentMeta], color: "var(--cm-comment)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--cm-punctuation)" },
  { tag: [t.invalid], color: "var(--cm-invalid)" },

  // Markdown: the source stays visible, so the rendered weight and size come
  // from the live-preview decorations rather than from these rules. What is
  // styled here is the syntax itself — the markers and the inline spans.
  { tag: t.heading, color: "var(--cm-heading)", fontWeight: "600" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--cm-link)", textDecoration: "underline" },
  { tag: t.url, color: "var(--cm-link)" },
  { tag: t.monospace, color: "var(--cm-string)" },
  { tag: t.quote, color: "var(--cm-comment)" },
  { tag: t.list, color: "var(--cm-punctuation)" },
  { tag: t.processingInstruction, color: "var(--cm-punctuation)" },
])
