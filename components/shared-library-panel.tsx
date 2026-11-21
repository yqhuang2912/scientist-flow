"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { SettingsEditorPane, SettingsPane } from "@/components/settings-shell"
import { SettingsList, SettingsListHeader } from "@/components/settings-list"
import { Spinner } from "@/components/ui/spinner"

type Summary = {
  id: string
  name: string
  displayName?: string | null
  description?: string
}
type Result<T> = { success: true; data: T } | { success: false; error: string }

export function LibraryReadStatus({
  label,
  error,
  retry,
}: {
  label: string
  error?: string
  retry: () => void
}) {
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={retry}>
          Retry
        </Button>
      </div>
    )
  }
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <Spinner /> {label}
    </p>
  )
}

// A selected summary can paint immediately while its full form values load.
export function useLibraryRead<T>(
  load: (() => Promise<Result<T>>) | null,
  accept: (value: T) => void
) {
  const [ready, setReady] = useState(!load)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!load) return
    let current = true
    load()
      .then((result) => {
        if (!current) return
        if (result.success) {
          accept(result.data)
          setReady(true)
        } else setError(result.error)
      })
      .catch(() => {
        if (current) setError("Could not reach the server.")
      })
    return () => {
      current = false
    }
  }, [load, accept, attempt])
  const retry = useCallback(() => {
    setReady(false)
    setError("")
    setAttempt((previous) => previous + 1)
  }, [])
  return { ready, error, retry }
}

function LibraryList<S extends Summary>({
  getList,
  query,
  noun,
  icon,
  onSelect,
}: {
  getList: () => Promise<Result<S[]>>
  query: string
  noun: string
  icon: ReactNode
  onSelect: (entry: S) => void
}) {
  const [entries, setEntries] = useState<S[]>([])
  const read = useLibraryRead(getList, setEntries)
  if (!read.ready) return <LibraryReadStatus label="Loading…" {...read} />
  const filtered = entries.filter((entry) =>
    [entry.displayName, entry.name, entry.description].some((value) =>
      value?.toLowerCase().includes(query)
    )
  )
  return (
    <SettingsList
      items={filtered.map((entry) => ({
        id: entry.id,
        name: entry.displayName || entry.name,
        description: entry.description,
        icon,
        onSelect: () => onSelect(entry),
      }))}
      icon={icon}
      emptyLabel={
        entries.length
          ? "No matching " + noun + "s"
          : "No shared " + noun + "s yet"
      }
    />
  )
}

export function SharedLibraryPanel<S extends Summary>({
  noun,
  title,
  description,
  icon,
  getList,
  renderForm,
  onOpen,
}: {
  noun: string
  title: string
  description: string
  icon: ReactNode
  getList: () => Promise<Result<S[]>>
  renderForm: (entry: S | null, close: () => void) => ReactNode
  onOpen?: (entry: S) => void
}) {
  const [search, setSearch] = useState("")
  const [editor, setEditor] = useState<{ entry: S | null } | null>(null)
  const label = "Shared " + title.toLowerCase()
  if (editor) {
    return (
      <SettingsEditorPane key={editor.entry?.id ?? "new"} label={label}>
        {renderForm(editor.entry, () => setEditor(null))}
      </SettingsEditorPane>
    )
  }
  return (
    <SettingsPane aria-label={label} className="gap-3">
      <SettingsListHeader
        title={title}
        description={description}
        noun={noun}
        search={search}
        onSearch={setSearch}
        onCreate={() => setEditor({ entry: null })}
      />
      <LibraryList
        getList={getList}
        query={search.trim().toLowerCase()}
        noun={noun}
        icon={icon}
        onSelect={onOpen ?? ((entry) => setEditor({ entry }))}
      />
    </SettingsPane>
  )
}
