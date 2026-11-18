"use client"

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
  type Ref,
} from "react"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { deleteSkill } from "@/actions/skill"
import { getSkill, getSkills } from "@/queries/skills"
import type { Skill } from "@/db/schema"
import { skillPath, type SkillResult } from "@/lib/skill-definition"
import { DocumentMarkdown } from "@/components/document-markdown"
import { SkillForm, type SkillLeaveGuard } from "@/components/skill-form"
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

type Page =
  | { view: "list" }
  | { view: "detail"; id: string }
  | { view: "form"; skill: Skill | null }

function SkillRead<T>({
  load,
  children,
}: {
  load: () => Promise<SkillResult<T>>
  children: (data: T) => ReactNode
}) {
  const [result, setResult] = useState<SkillResult<T> | null>(null)
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

function DeleteSkill({
  skill,
  onDeleted,
}: {
  skill: Skill
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  function remove() {
    setError("")
    startTransition(async () => {
      try {
        const result = await deleteSkill(skill.id)
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
          <AlertDialogTitle>Delete skill?</AlertDialogTitle>
          <AlertDialogDescription className="wrap-anywhere">
            Permanently delete{" "}
            {skill.displayName
              ? `${skill.displayName} (${skill.name})`
              : skill.name}{" "}
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
            {pending && <Spinner />}Delete skill
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

export function SkillsSettingsPanel({
  guard,
}: {
  guard: Ref<SkillLeaveGuard>
}) {
  const [page, setPage] = useState<Page>({ view: "list" })
  const [search, setSearch] = useState("")
  const id = page.view === "detail" ? page.id : null
  const loadDetail = useCallback(() => getSkill(id), [id])
  const showList = () => setPage({ view: "list" })
  const showDetail = (id: string) => setPage({ view: "detail", id })
  const query = search.trim().toLowerCase()
  return (
    <section
      aria-label="Shared skills"
      className="flex min-w-0 flex-col gap-3 p-4"
    >
      {page.view === "form" ? (
        <SkillForm
          skill={page.skill}
          guard={guard}
          onSaved={showDetail}
          onCancel={() => (page.skill ? showDetail(page.skill.id) : showList())}
        />
      ) : page.view === "detail" ? (
        <>
          <Button
            className="w-fit"
            size="compact"
            variant="ghost"
            onClick={showList}
          >
            <ArrowLeftIcon />
            Skills
          </Button>
          <SkillRead key={page.id} load={loadDetail}>
            {(skill) => (
              <>
                <div className="space-y-1">
                  <h2 className="type-section-title wrap-anywhere">
                    {skill.displayName || skill.name}
                  </h2>
                  <p className="font-mono text-xs wrap-anywhere text-muted-foreground">
                    {skillPath(skill.name)}
                  </p>
                </div>
                <p className="text-sm wrap-anywhere whitespace-pre-wrap">
                  {skill.description}
                </p>
                <div className="flex items-center gap-1 border-b pb-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage({ view: "form", skill })}
                  >
                    <PencilIcon />
                    Edit
                  </Button>
                  <DeleteSkill skill={skill} onDeleted={showList} />
                </div>
                <div className="min-w-0">
                  <DocumentMarkdown content={skill.instructions} />
                </div>
              </>
            )}
          </SkillRead>
        </>
      ) : (
        <>
          <div className="pr-6">
            <h2 className="type-section-title">Skills</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              Create shared skills for your bots.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Search skills"
              placeholder="Search skills…"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              size="sm"
              onClick={() => setPage({ view: "form", skill: null })}
            >
              <PlusIcon />
              New skill
            </Button>
          </div>
          <SkillRead load={getSkills}>
            {(skills) => {
              const filtered = skills.filter((skill) =>
                [skill.displayName, skill.name, skill.description].some(
                  (value) => value?.toLowerCase().includes(query)
                )
              )
              if (!filtered.length)
                return (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <BookOpenIcon />
                      </EmptyMedia>
                      <EmptyTitle>
                        {skills.length
                          ? "No matching skills"
                          : "No shared skills yet"}
                      </EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )
              return (
                <ul className="flex min-w-0 flex-col gap-0.5">
                  {filtered.map((skill) => (
                    <li key={skill.id}>
                      <Button
                        variant="ghost"
                        onClick={() => showDetail(skill.id)}
                        className="h-auto w-full justify-between gap-2 rounded-xl px-2.5 py-2 text-left"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate type-control">
                            {skill.displayName || skill.name}
                          </span>
                          {skill.displayName && (
                            <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                              {skill.name}
                            </span>
                          )}
                          <span className="truncate text-xs font-normal text-muted-foreground">
                            {skill.description}
                          </span>
                          <time
                            className="text-xs font-normal text-muted-foreground"
                            dateTime={skill.updatedAt.toISOString()}
                          >
                            Updated {dateFormat.format(skill.updatedAt)}
                          </time>
                        </span>
                        <ChevronRightIcon className="text-muted-foreground" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            }}
          </SkillRead>
        </>
      )}
    </section>
  )
}
