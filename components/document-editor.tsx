"use client"

import { useEffect, useRef } from "react"
import { EditorState, Compartment, type Extension } from "@codemirror/state"
import { EditorView, keymap, highlightActiveLine, lineNumbers } from "@codemirror/view"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands"
import {
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
  foldGutter,
} from "@codemirror/language"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import { editorHighlightStyle } from "@/lib/editor-highlight"

/**
 * One editing surface for every workspace file.
 *
 * Markdown renders in place: headings, emphasis, and code take their styling
 * as you type, and the syntax markers show again on whichever line the cursor
 * is on. Code files get the grammar for their language. Either way the buffer
 * is the file's own text, so what is saved is exactly what was opened.
 */

/** Resolve a CodeMirror language from the workspace's Shiki language id. */
async function resolveLanguage(
  language: string
): Promise<Extension | undefined> {
  if (language === "markdown")
    return markdown({ base: markdownLanguage, codeLanguages: languages })
  if (language === "text") return undefined
  // `language-data` indexes by name, alias, and extension, which covers the
  // Shiki ids this project uses; anything unknown loads no grammar rather
  // than failing the editor.
  const description =
    languages.find((item) => item.name.toLowerCase() === language) ??
    languages.find((item) => item.alias.includes(language))
  if (!description) return undefined
  try {
    return await description.load()
  } catch {
    // A grammar that fails to load leaves the file editable without
    // highlighting, which is better than an editor that fails to open.
    return undefined
  }
}

export function DocumentEditor({
  value,
  language,
  readOnly,
  label,
  onChange,
  onSave,
}: {
  value: string
  language: string
  readOnly: boolean
  label: string
  onChange: (value: string) => void
  onSave: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // A compartment lets read-only flip without rebuilding the editor, which
  // would discard the selection, scroll position, and undo history.
  const editable = useRef(new Compartment())
  // Callbacks live in refs for the same reason: a re-render must not have to
  // reconstruct the view.
  const handlers = useRef({ onChange, onSave })
  useEffect(() => {
    handlers.current = { onChange, onSave }
  }, [onChange, onSave])

  // The editor is created once per file and per language. `value` is left out
  // on purpose: typing already updates the view, and reconstructing it here
  // would fight the user. External changes are pushed in the effect below.
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    let cancelled = false
    let instance: EditorView | null = null

    void resolveLanguage(language).then((support) => {
      if (cancelled || !parent) return
      const extensions: Extension[] = [
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        syntaxHighlighting(editorHighlightStyle, { fallback: true }),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              handlers.current.onSave()
              return true
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            handlers.current.onChange(update.state.doc.toString())
        }),
        EditorView.contentAttributes.of({ "aria-label": label }),
        editable.current.of(readOnlyExtension(readOnly)),
      ]
      if (support) extensions.push(support)
      // A gutter is worth its width only where it carries something. Code gets
      // line numbers and folding; markdown has a preview of its own and reads
      // as prose; plain text and logs have neither structure to fold nor
      // numbering worth the column, so they get no gutter at all.
      if (support && language !== "markdown")
        extensions.push(lineNumbers(), foldGutter())

      instance = new EditorView({
        state: EditorState.create({ doc: value, extensions }),
        parent,
      })
      view.current = instance
    })

    return () => {
      cancelled = true
      instance?.destroy()
      if (view.current === instance) view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, label])

  // Reload from disk, discard, and conflict resolution all replace the buffer
  // from outside. Only a genuine difference is written back, so this never
  // echoes the user's own keystrokes.
  useEffect(() => {
    const instance = view.current
    if (!instance) return
    const current = instance.state.doc.toString()
    if (current === value) return
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  useEffect(() => {
    const instance = view.current
    if (!instance) return
    instance.dispatch({
      effects: editable.current.reconfigure(readOnlyExtension(readOnly)),
    })
  }, [readOnly])

  return (
    <div
      ref={host}
      data-language={language}
      className="cm-host size-full overflow-hidden"
    />
  )
}

function readOnlyExtension(readOnly: boolean): Extension {
  return readOnly
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : []
}
