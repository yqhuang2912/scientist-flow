"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { BrainIcon, Trash2Icon } from "lucide-react"
import {
  listBotMemories,
  removeBotMemory,
  saveBotMemory,
} from "@/actions/bot-memory"
import {
  botMemoryFormSchema,
  botMemoryLimit,
  botMemoryTextLimit,
} from "@/db/schema"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type MemoryDraft = { messageId: string; text: string }

export function SaveMemoryDialog({
  chatId,
  botName,
  draft,
  close,
}: {
  chatId: string
  botName: string
  draft: MemoryDraft
  close: () => void
}) {
  const formId = useId()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")
  const form = useForm<{ text: string }>({
    resolver: zodResolver(botMemoryFormSchema),
    defaultValues: { text: draft.text },
  })
  const invalid = form.formState.errors.text
  const submit = form.handleSubmit((values) => {
    if (pending) return
    setError("")
    startTransition(async () => {
      try {
        const result = await saveBotMemory(chatId, draft.messageId, values)
        if (!result.success) {
          setError(result.error)
          return
        }
        toast.add({
          type: result.duplicate ? "info" : "success",
          title: result.duplicate
            ? "Preference already saved"
            : "Preference saved",
        })
        close()
      } catch {
        setError("Could not save this preference. Please try again.")
      }
    })
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close()
      }}
    >
      <DialogContent className="overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remember with {botName}</DialogTitle>
          <DialogDescription>
            Applies to every task this bot participates in.
          </DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={!!invalid}>
              <FieldLabel htmlFor={formId + "-text"}>Preference</FieldLabel>
              <Textarea
                id={formId + "-text"}
                rows={4}
                readOnly={pending}
                aria-invalid={!!invalid}
                {...form.register("text")}
              />
              <span className="text-xs text-muted-foreground">
                Up to {botMemoryTextLimit} characters.
              </span>
              <FieldError errors={[invalid]} />
            </Field>
          </FieldGroup>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={close}
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} size="sm" disabled={pending}>
            {pending && <Spinner />}Save memory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MemoryList({ chatId }: { chatId: string }) {
  const [rows, setRows] = useState<{ id: string; text: string }[] | null>(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [pending, startTransition] = useTransition()
  useEffect(() => {
    let current = true
    listBotMemories(chatId)
      .then((result) => {
        if (!current) return
        if (result.success) setRows(result.data)
        else setError(result.error)
      })
      .catch(() => {
        if (current) setError("Could not load bot memory.")
      })
    return () => {
      current = false
    }
  }, [chatId, attempt])
  const remove = (id: string) => {
    setError("")
    startTransition(async () => {
      try {
        const result = await removeBotMemory(chatId, id)
        if (!result.success) {
          setError(result.error)
          return
        }
        setRows((previous) => previous?.filter((row) => row.id !== id) ?? null)
        toast.add({
          type: "success",
          title: result.removed
            ? "Preference removed"
            : "Preference already removed",
        })
      } catch {
        setError("Could not remove this preference. Please try again.")
      }
    })
  }
  return (
    <div className="min-h-0 space-y-2">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-destructive"
        >
          {error}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError("")
              setRows(null)
              setAttempt((n) => n + 1)
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {!rows ? (
        !error && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Spinner />
            Loading memories…
          </p>
        )
      ) : rows.length ? (
        <>
          <ul className="max-h-[50dvh] divide-y overflow-y-auto">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 text-sm wrap-anywhere whitespace-pre-wrap">
                  {row.text}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={"Remove preference: " + row.text}
                  title="Remove preference"
                  disabled={pending}
                  onClick={() => remove(row.id)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {rows.length} of {botMemoryLimit} preferences
          </p>
        </>
      ) : (
        <p className="py-2 text-sm text-muted-foreground">
          No saved preferences yet.
        </p>
      )}
    </div>
  )
}

export function BotMemoryButton({
  chatId,
  botName,
}: {
  chatId: string
  botName: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Bot memory"
                />
              }
            />
          }
        >
          <BrainIcon />
        </TooltipTrigger>
        <TooltipContent>Bot memory</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{botName}’s memory</DialogTitle>
          <DialogDescription>
            Saved preferences apply to every task this bot participates in.
          </DialogDescription>
        </DialogHeader>
        {open && <MemoryList chatId={chatId} />}
      </DialogContent>
    </Dialog>
  )
}
