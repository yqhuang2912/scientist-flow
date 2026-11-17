"use client"

import { useState, useTransition } from "react"
import {
  compactChatAvatarStyles,
  compactItemStyles,
  compactItemStates,
} from "@/components/ui/compact-styles"
import { cn } from "@/lib/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { ListTodoIcon, Trash2Icon } from "lucide-react"

import { createTask, deleteTask, updateTask } from "@/actions/chat"
import { ChatAvatar } from "@/components/chat-avatar"
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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { taskFormSchema, type TaskFormValues } from "@/db/schema"
import type { BotSummary } from "@/queries/bots"
import type { ChatWithBot } from "@/queries/chats"

interface TaskDialogProps {
  bots: BotSummary[]
  chat?: Pick<ChatWithBot, "id" | "name" | "bots">
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskDialog({
  bots,
  chat,
  open,
  onOpenChange,
}: TaskDialogProps) {
  const isEditing = Boolean(chat)
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const defaultValues: TaskFormValues = {
    name: chat?.name ?? "",
    botIds: chat?.bots.map((bot) => bot.id) ?? [],
  }
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues,
  })

  function handleOpenChange(nextOpen: boolean) {
    if (isPending) return
    onOpenChange(nextOpen)
    if (nextOpen) {
      form.reset(defaultValues)
      setServerError(null)
      setDeleteError(null)
    } else {
      setServerError(null)
      setDeleteDialogOpen(false)
      setDeleteError(null)
    }
  }

  function onSubmit(values: TaskFormValues) {
    if (isPending) return
    setServerError(null)
    startTransition(async () => {
      try {
        const result =
          isEditing && chat
            ? await updateTask(chat.id, values)
            : await createTask(values)
        if (!result.success) {
          setServerError(result.error)
          return
        }

        handleOpenChange(false)
        if (!isEditing) {
          router.push(`/chats/${result.chat.id}`)
        }
        router.refresh()
      } catch {
        setServerError("Could not save the task. Please try again.")
      }
    })
  }

  function handleDelete() {
    if (!chat || isPending) {
      return
    }

    setDeleteError(null)
    startTransition(async () => {
      try {
        const result = await deleteTask(chat.id)

        if (!result.success) {
          setDeleteError(result.error)
          return
        }

        setDeleteDialogOpen(false)
        handleOpenChange(false)
        router.push("/")
        router.refresh()
      } catch {
        setDeleteError("Could not delete the task. Please try again.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="gap-1 px-4 pt-4 pr-12">
          <div className="flex items-center gap-2">
            <ListTodoIcon className="size-4 shrink-0" aria-hidden="true" />
            <DialogTitle>{isEditing ? "Edit task" : "New task"}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Name the task and choose the bots to work on it.
          </DialogDescription>
        </DialogHeader>

        <form
          id="task-form"
          className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto p-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FieldGroup className="gap-4">
            <Field
              className="gap-1.5"
              data-invalid={!!form.formState.errors.name}
            >
              <FieldLabel htmlFor="task-name">Task name</FieldLabel>
              <Input
                id="task-name"
                placeholder="e.g. Literature review"
                autoComplete="off"
                disabled={isPending}
                aria-invalid={!!form.formState.errors.name}
                aria-describedby={
                  form.formState.errors.name ? "task-name-error" : undefined
                }
                {...form.register("name")}
              />
              <FieldError
                id="task-name-error"
                errors={[form.formState.errors.name]}
              />
            </Field>

            <Controller
              control={form.control}
              name="botIds"
              render={({ field, fieldState }) => (
                <FieldSet
                  className="min-w-0 gap-1.5"
                  disabled={isPending}
                  data-invalid={!!fieldState.error}
                >
                  <FieldLegend variant="label">Bots</FieldLegend>
                  <FieldDescription id="task-bots-hint">
                    {bots.length
                      ? "Select at least one bot."
                      : "Add a bot in Settings to create a task."}
                  </FieldDescription>
                  <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                    {bots.map((bot) => {
                      const checked = field.value.includes(bot.id)
                      return (
                        <label
                          key={bot.id}
                          data-active={checked || undefined}
                          className={cn(
                            compactItemStyles,
                            compactItemStates,
                            "flex h-7.5 cursor-pointer items-center focus-within:bg-highlight has-disabled:pointer-events-none has-disabled:opacity-50"
                          )}
                        >
                          <ChatAvatar
                            seed={bot.avatar}
                            animated
                            alt={`${bot.name} avatar`}
                            className={compactChatAvatarStyles}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {bot.name}
                          </span>
                          <Checkbox
                            className="after:inset-0"
                            disabled={isPending}
                            aria-invalid={!!fieldState.error}
                            aria-describedby={
                              fieldState.error
                                ? "task-bots-hint task-bots-error"
                                : "task-bots-hint"
                            }
                            onBlur={field.onBlur}
                            checked={checked}
                            onCheckedChange={(value) => {
                              const nextValue =
                                value === true
                                  ? [...field.value, bot.id]
                                  : field.value.filter((id) => id !== bot.id)
                              field.onChange(nextValue)
                            }}
                          />
                        </label>
                      )
                    })}
                  </div>
                  <FieldError
                    id="task-bots-error"
                    errors={[fieldState.error]}
                  />
                </FieldSet>
              )}
            />
          </FieldGroup>

          {serverError && (
            <p className="text-[13px] text-destructive" role="alert">
              {serverError}
            </p>
          )}
        </form>

        <DialogFooter className="mx-0 mt-0 mb-0 flex-row flex-wrap justify-end">
          {isEditing && chat && (
            <AlertDialog
              open={deleteDialogOpen}
              onOpenChange={(nextOpen) => {
                if (isPending) return
                setDeleteDialogOpen(nextOpen)
                if (!nextOpen) {
                  setDeleteError(null)
                }
              }}
            >
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="mr-auto"
                    disabled={isPending}
                  />
                }
              >
                <Trash2Icon data-icon="inline-start" />
                Delete task
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {chat.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the task from the app. Workspace
                    files remain on disk. This action cannot be undone.
                  </AlertDialogDescription>
                  {deleteError && (
                    <p className="text-[13px] text-destructive" role="alert">
                      {deleteError}
                    </p>
                  )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isPending}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    type="button"
                    variant="destructive"
                    disabled={isPending}
                    onClick={handleDelete}
                  >
                    {isPending && <Spinner data-icon="inline-start" />}
                    {isPending ? "Deleting…" : "Delete task"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <DialogClose
            render={
              <Button type="button" variant="outline" disabled={isPending} />
            }
          >
            Cancel
          </DialogClose>
          <Button
            type="submit"
            form="task-form"
            disabled={isPending || bots.length === 0}
            className="sm:min-w-24"
          >
            {isPending && <Spinner data-icon="inline-start" />}
            {isPending
              ? isEditing
                ? "Saving…"
                : "Creating…"
              : isEditing
                ? "Save changes"
                : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
