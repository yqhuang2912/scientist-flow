"use client"

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react"
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type Summary = {
  id: string
  name: string
  displayName: string | null
  description: string
  updatedAt: Date
}
type Result<T> = { success: true; data: T } | { success: false; error: string }
type Page<T> =
  | { view: "list" }
  | { view: "detail"; id: string }
  | { view: "form"; entry: T | null }

function LibraryRead<T>({
  load,
  children,
}: {
  load: () => Promise<Result<T>>
  children: (data: T) => ReactNode
}) {
  const [result, setResult] = useState<Result<T> | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    load()
      .then((value) => {
        if (current) setResult(value)
      })
      .catch(() => {
        if (current)
          setResult({ success: false, error: "Could not reach the server." })
      })
    return () => {
      current = false
    }
  }, [load, attempt])
  if (!result)
    return (
      <p
        role="status"
        className="flex items-center gap-2 py-3 text-sm text-muted-foreground"
      >
        <Spinner />
        Loading…
      </p>
    )
  if (!result.success)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setResult(null)
            setAttempt(attempt + 1)
          }}
        >
          Retry
        </Button>
      </div>
    )
  return children(result.data)
}

function DeleteEntry({
  entry,
  noun,
  removeEntry,
  onDeleted,
}: {
  entry: Summary
  noun: string
  removeEntry: (id: string) => Promise<Result<{ id: string }>>
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  function remove() {
    setError("")
    startTransition(async () => {
      try {
        const result = await removeEntry(entry.id)
        if (result.success) {
          setOpen(false)
          onDeleted()
        } else setError(result.error)
      } catch {
        setError("Could not reach the server. Please try again.")
      }
    })
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setError("")
          setOpen(value)
        }
      }}
    >
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" className="text-destructive" />
        }
      >
        <Trash2Icon />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {noun}?</AlertDialogTitle>
          <AlertDialogDescription className="wrap-anywhere">
            Permanently delete{" "}
            {entry.displayName
              ? `${entry.displayName} (${entry.name})`
              : entry.name}{" "}
            from the shared library?
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={remove}
          >
            {pending && <Spinner />}Delete {noun}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function SharedLibraryPanel<S extends Summary, T extends Summary>({
  noun,
  title,
  description,
  icon,
  getList,
  getEntry,
  removeEntry,
  renderForm,
  identifier,
  renderDetail,
  listMeta,
}: {
  noun: string
  title: string
  description: string
  icon: ReactNode
  getList: () => Promise<Result<S[]>>
  getEntry: (id: unknown) => Promise<Result<T>>
  removeEntry: (id: string) => Promise<Result<{ id: string }>>
  renderForm: (
    entry: T | null,
    saved: (id: string) => void,
    cancel: () => void
  ) => ReactNode
  identifier: (entry: T) => string
  renderDetail: (entry: T) => ReactNode
  listMeta?: (entry: S) => string
}) {
  const [page, setPage] = useState<Page<T>>({ view: "list" })
  const [search, setSearch] = useState("")
  const id = page.view === "detail" ? page.id : null
  const loadDetail = useCallback(() => getEntry(id), [getEntry, id])
  const showList = () => setPage({ view: "list" })
  const showDetail = (id: string) => setPage({ view: "detail", id })
  const query = search.trim().toLowerCase()
  return (
    <section
      aria-label={"Shared " + title.toLowerCase()}
      className="flex min-w-0 flex-col gap-3 p-4"
    >
      {page.view === "form" ? (
        renderForm(page.entry, showDetail, () =>
          page.entry ? showDetail(page.entry.id) : showList()
        )
      ) : page.view === "detail" ? (
        <>
          <Button
            className="w-fit"
            size="compact"
            variant="ghost"
            onClick={showList}
          >
            <ArrowLeftIcon />
            {title}
          </Button>
          <LibraryRead key={page.id} load={loadDetail}>
            {(entry) => (
              <>
                <div className="space-y-1">
                  <h2 className="type-section-title wrap-anywhere">
                    {entry.displayName || entry.name}
                  </h2>
                  <p className="font-mono text-xs wrap-anywhere text-muted-foreground">
                    {identifier(entry)}
                  </p>
                </div>
                <p className="text-sm wrap-anywhere whitespace-pre-wrap">
                  {entry.description}
                </p>
                <div className="flex items-center gap-1 border-b pb-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage({ view: "form", entry })}
                  >
                    <PencilIcon />
                    Edit
                  </Button>
                  <DeleteEntry
                    entry={entry}
                    noun={noun}
                    removeEntry={removeEntry}
                    onDeleted={showList}
                  />
                </div>
                <div className="min-w-0">{renderDetail(entry)}</div>
              </>
            )}
          </LibraryRead>
        </>
      ) : (
        <>
          <div className="pr-6">
            <h2 className="type-section-title">{title}</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              aria-label={"Search " + title.toLowerCase()}
              placeholder={"Search " + title.toLowerCase() + "…"}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              size="sm"
              onClick={() => setPage({ view: "form", entry: null })}
            >
              <PlusIcon />
              New {noun}
            </Button>
          </div>
          <LibraryRead load={getList}>
            {(entries) => {
              const filtered = entries.filter((entry) =>
                [entry.displayName, entry.name, entry.description].some(
                  (value) => value?.toLowerCase().includes(query)
                )
              )
              if (!filtered.length)
                return (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">{icon}</EmptyMedia>
                      <EmptyTitle>
                        {entries.length
                          ? "No matching " + title.toLowerCase()
                          : "No shared " + title.toLowerCase() + " yet"}
                      </EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )
              return (
                <ul className="flex min-w-0 flex-col gap-0.5">
                  {filtered.map((entry) => (
                    <li key={entry.id}>
                      <Button
                        variant="ghost"
                        onClick={() => showDetail(entry.id)}
                        className="h-auto w-full justify-between gap-2 rounded-xl px-2.5 py-2 text-left"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate type-control">
                            {entry.displayName || entry.name}
                          </span>
                          {entry.displayName && (
                            <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                              {entry.name}
                            </span>
                          )}
                          <span className="truncate text-xs font-normal text-muted-foreground">
                            {entry.description}
                          </span>
                          <time
                            className="text-xs font-normal text-muted-foreground"
                            dateTime={entry.updatedAt.toISOString()}
                          >
                            {listMeta && <>{listMeta(entry)} · </>}Updated{" "}
                            {dateFormat.format(entry.updatedAt)}
                          </time>
                        </span>
                        <ChevronRightIcon className="text-muted-foreground" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            }}
          </LibraryRead>
        </>
      )}
    </section>
  )
}
