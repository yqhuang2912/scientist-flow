"use client"

import { useState, useTransition } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { nanoid } from "nanoid"
import { useForm } from "react-hook-form"
import { PlusIcon, ShuffleIcon } from "lucide-react"

import { createBot } from "@/actions/bot"
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
}

export function BotDialog({ initialAvatarSeed }: BotDialogProps) {
  const [open, setOpen] = useState(false)
  const [avatarSeed, setAvatarSeed] = useState(initialAvatarSeed)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const form = useForm<BotFormValues>({
    resolver: zodResolver(botFormSchema),
    defaultValues: {
      avatar: initialAvatarSeed,
      name: "Ada",
      job: botPresets[0].job,
      instructions: defaultInstructions,
    },
  })

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
    setServerError(null)

    startTransition(async () => {
      const result = await createBot({
        ...values,
        instructions: values.instructions?.trim() || undefined,
      })

      if (!result.success) {
        setServerError(result.error)
        return
      }

      const nextSeed = nanoid()
      setAvatarSeed(nextSeed)
      form.reset({
        avatar: nextSeed,
        name: "Ada",
        job: botPresets[0].job,
        instructions: defaultInstructions,
      })
      setOpen(false)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setServerError(null)
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm" className="rounded-md px-3" />
        }
      >
        <PlusIcon data-icon="inline-start" />
        Create a new bot
      </DialogTrigger>
      <DialogContent className="dark max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-4 pb-0 sm:max-w-2xl">
        <DialogHeader className="gap-1">
          <DialogTitle>New bot</DialogTitle>
          <DialogDescription>
            Give it a face, a name, and a job to do.
          </DialogDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            {botPresets.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </DialogHeader>

        <form
          id="bot-form"
          className="flex flex-col gap-4 pt-5 pb-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <div className="flex items-center gap-3">
            <ChatAvatar
              seed={avatarSeed}
              animated
              className="size-10 rounded-lg"
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
          </FieldGroup>

          {serverError && (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          )}
        </form>
        <DialogFooter className="mt-0 mb-0 flex-row justify-end">
          <DialogClose
            render={
              <Button type="button" variant="outline" disabled={isPending} />
            }
          >
            Cancel
          </DialogClose>
          <Button type="submit" form="bot-form" disabled={isPending}>
            {isPending && <Spinner data-icon="inline-start" />}
            Create bot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
