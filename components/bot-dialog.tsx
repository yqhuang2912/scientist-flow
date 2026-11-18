"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { nanoid } from "nanoid"
import { useRouter } from "next/navigation"
import { useController, useForm } from "react-hook-form"
import { PlusIcon, ShuffleIcon, Trash2Icon } from "lucide-react"

import { createBot, deleteBot, updateBot } from "@/actions/bot"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { botFormSchema, type BotFormValues } from "@/db/schema"

import type { SkillSummary } from "@/db/schema"
import { getSkills, getBotSkillIds } from "@/queries/skills"
import { BotSkillPicker } from "@/components/bot-skill-picker"

const botPresets = [
  {
    label: "Research assistant",
    job: "Research assistant",
    instructions:
      "Answer briefly, cite sources, and ask before running anything destructive.",
  },
  {
    label: "Code reviewer",
    job: "Code reviewer",
    instructions:
      "Review code carefully, explain the impact of each issue, and suggest focused fixes.",
  },
  {
    label: "Writing editor",
    job: "Writing editor",
    instructions:
      "Improve clarity and flow while preserving the writer's intent and voice.",
  },
  {
    label: "Tutor",
    job: "Tutor",
    instructions:
      "Teach step by step, ask guiding questions, and adapt explanations to the learner.",
  },
] as const

const defaultInstructions = botPresets[0].instructions

interface BotDialogProps {
  initialAvatarSeed: string
  bot?: {
    id: string
    avatar: string
    name: string
    job: string
    instructions: string | null
  }
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
}

export function BotDialog({
  initialAvatarSeed,
  bot,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: BotDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  function handleOpenChange(value: boolean) {
    if (openProp === undefined) setInternalOpen(value)
    onOpenChange?.(value)
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {showTrigger && !bot && (
        <DialogTrigger
          render={<Button variant="secondary" size="sm" className="px-3" />}
        >
          <PlusIcon data-icon="inline-start" />
          Create a new bot
        </DialogTrigger>
      )}
      {open && (
        <BotForm
          key={bot?.id ?? "new"}
          bot={bot}
          initialAvatarSeed={initialAvatarSeed}
          onClose={() => handleOpenChange(false)}
        />
      )}
    </Dialog>
  )
}

function BotForm({
  bot,
  initialAvatarSeed,
  onClose,
}: Pick<BotDialogProps, "bot" | "initialAvatarSeed"> & {
  onClose: () => void
}) {
  const isEditing = Boolean(bot)
  const router = useRouter()
  const submitting = useRef(false)
  const [requestKey] = useState(() => nanoid())
  const [avatarSeed, setAvatarSeed] = useState(initialAvatarSeed)
  const [serverError, setServerError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const defaultValues = {
    skillIds: [] as string[],
    avatar: bot?.avatar ?? initialAvatarSeed,
    name: bot?.name ?? "Ada",
    job: bot?.job ?? botPresets[0].job,
    instructions: bot?.instructions ?? (bot ? "" : defaultInstructions),
  }
  const form = useForm<BotFormValues>({
    resolver: zodResolver(botFormSchema),
    defaultValues,
  })
  const selection = useController({ control: form.control, name: "skillIds" })
  const [options, setOptions] = useState<SkillSummary[] | null>(null)
  const [loadError, setLoadError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const botId = bot?.id
  const resetField = form.resetField
  useEffect(() => {
    let current = true
    async function load() {
      try {
        const [catalog, binding] = await Promise.all([
          getSkills(),
          botId ? getBotSkillIds(botId) : null,
        ])
        if (!current) return
        if (!catalog.success || (binding && !binding.success)) throw new Error()
        const ids = binding?.data ?? []
        if (ids.some((id) => !catalog.data.some((skill) => skill.id === id)))
          throw new Error()
        resetField("skillIds", { defaultValue: ids })
        setOptions(catalog.data)
      } catch {
        if (current) setLoadError("Could not load the skill selection.")
      }
    }
    void load()
    return () => {
      current = false
    }
  }, [botId, resetField, attempt])

  function shuffleAvatar() {
    const nextSeed = nanoid()
    setAvatarSeed(nextSeed)
    form.setValue("avatar", nextSeed, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  function applyPreset(preset: (typeof botPresets)[number]) {
    form.setValue("job", preset.job, {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.setValue("instructions", preset.instructions, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  function onSubmit(values: BotFormValues) {
    if (!options || submitting.current) return
    submitting.current = true
    setServerError(null)

    startTransition(async () => {
      const input = {
        ...values,
        instructions: values.instructions?.trim() || undefined,
      }
      try {
        const result =
          isEditing && bot
            ? await updateBot(bot.id, input)
            : await createBot(input, requestKey)

        if (!result.success) {
          setServerError(result.error)
          return
        }

        onClose()
        router.refresh()
      } catch {
        setServerError("Could not save the bot. Please try again.")
      } finally {
        submitting.current = false
      }
    })
  }

  function handleDelete() {
    if (!bot) {
      return
    }

    setDeleteError(null)
    startTransition(async () => {
      const result = await deleteBot(bot.id)

      if (!result.success) {
        setDeleteError(result.error)
        return
      }

      setDeleteDialogOpen(false)
      onClose()
      router.push("/")
      router.refresh()
    })
  }

  return (
    <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <DialogHeader className="gap-1.5 px-4 pt-4 pr-12">
        <DialogTitle>{isEditing ? "Edit bot" : "New bot"}</DialogTitle>
        <DialogDescription>
          {isEditing
            ? "Update its face, name, and job."
            : "Give it a face, a name, and a job to do."}
        </DialogDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {botPresets.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"

              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </DialogHeader>

      <form
        id="bot-form"
        className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto px-4 pt-4 pb-4"
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      >
        <div className="flex items-center gap-3">
          <ChatAvatar
            seed={avatarSeed}
            animated
            className="size-10 rounded-md"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <FieldTitle>Face</FieldTitle>
            <FieldDescription className="sm:whitespace-nowrap">
              Shuffle until you find one you like.
            </FieldDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={shuffleAvatar}
          >
            <ShuffleIcon data-icon="inline-start" />
            Shuffle
          </Button>
        </div>

        <FieldGroup className="gap-4">
          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor="bot-name">Name</FieldLabel>
            <Input
              id="bot-name"
              placeholder="Ada"
              aria-invalid={!!form.formState.errors.name}
              {...form.register("name")}
            />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>

          <Field data-invalid={!!form.formState.errors.job}>
            <FieldLabel htmlFor="bot-job">Job</FieldLabel>
            <Input
              id="bot-job"
              placeholder="Research assistant"
              aria-invalid={!!form.formState.errors.job}
              {...form.register("job")}
            />
            <FieldError errors={[form.formState.errors.job]} />
          </Field>

          <Field data-invalid={!!form.formState.errors.instructions}>
            <FieldLabel htmlFor="bot-instructions">
              How it should work
            </FieldLabel>
            <Textarea
              id="bot-instructions"
              placeholder={defaultInstructions}
              className="min-h-24 resize-none"
              aria-invalid={!!form.formState.errors.instructions}
              {...form.register("instructions")}
            />
            <FieldError errors={[form.formState.errors.instructions]} />
          </Field>
          <BotSkillPicker
            options={options}
            ids={selection.field.value}
            onChange={selection.field.onChange}
            disabled={isPending}
            error={loadError}
            validationError={selection.fieldState.error?.message}
            onRetry={() => {
              setLoadError("")
              setAttempt((n) => n + 1)
            }}
            onManage={() => {
              onClose()
              window.dispatchEvent(new Event("scientistflow:manage-skills"))
            }}
          />
        </FieldGroup>

        {serverError && (
          <p className="text-sm text-destructive" role="alert">
            {serverError}
          </p>
        )}
      </form>
      <DialogFooter className="mx-0 mt-0 mb-0 flex-row flex-wrap justify-end">
        {isEditing && bot && (
          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={(open) => {
              setDeleteDialogOpen(open)
              if (!open) {
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
              Delete bot
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {bot.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the bot and its direct chat. This
                  action cannot be undone.
                </AlertDialogDescription>
                {deleteError && (
                  <p className="text-sm text-destructive" role="alert">
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
                  Delete bot
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
        <Button type="submit" form="bot-form" disabled={isPending || !options}>
          {isPending && <Spinner data-icon="inline-start" />}
          {isEditing ? "Save changes" : "Create bot"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
