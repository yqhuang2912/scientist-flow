"use client"

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type Ref,
} from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { nanoid } from "nanoid"
import { useRouter } from "next/navigation"
import { useController, useForm } from "react-hook-form"
import { PlusIcon, ShuffleIcon } from "lucide-react"

import { createBot, deleteBot, updateBot } from "@/actions/bot"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  useSettingsFormGuard,
  type SettingsLeaveGuard,
} from "@/components/settings-form-guard"
import {
  SettingsDialogContent,
  SettingsFormBody,
  SettingsFormFooter,
} from "@/components/settings-shell"
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { SettingsDeleteAction } from "@/components/settings-detail-actions"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { botFormSchema, type BotFormValues } from "@/db/schema"

import type { SkillSummary, ToolSummary } from "@/db/schema"
import { getSkills, getBotSkillIds } from "@/queries/skills"
import { BotBindingPicker } from "@/components/bot-binding-picker"
import { getTools, getBotToolIds } from "@/queries/tools"
import { getModelConnections } from "@/actions/model-connections"
import { BotModelFields } from "./bot-model-fields"
import {
  choiceProblem,
  type ConnectionSummary,
  type ModelChoice,
} from "@/lib/model-catalog"

const defaultInstructions =
  "Answer briefly, cite sources, and ask before running anything destructive."

interface BotDialogProps {
  initialAvatarSeed: string
  bot?: {
    id: string
    avatar: string
    name: string
    job: string
    instructions: string | null
    modelChoice?: ModelChoice | null
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
  const guard = useRef<SettingsLeaveGuard>(null)
  const open = openProp ?? internalOpen
  function handleOpenChange(value: boolean) {
    if (openProp === undefined) setInternalOpen(value)
    onOpenChange?.(value)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next, event) => {
        if (!next && guard.current) {
          event.cancel()
          guard.current(() => handleOpenChange(false))
        } else handleOpenChange(next)
      }}
    >
      {showTrigger && !bot && (
        <DialogTrigger
          render={<Button variant="secondary" size="sm" className="px-3" />}
        >
          <PlusIcon data-icon="inline-start" />
          Create a new bot
        </DialogTrigger>
      )}
      {open && (
        <SettingsDialogContent className="grid-rows-[auto_minmax(0,1fr)_auto]">
          <BotForm
            key={bot?.id ?? "new"}
            bot={bot}
            initialAvatarSeed={initialAvatarSeed}
            standalone
            guard={guard}
            onClose={() => handleOpenChange(false)}
            onManageLibrary={(tab) => {
              handleOpenChange(false)
              window.dispatchEvent(new Event("scientistflow:manage-" + tab))
            }}
          />
        </SettingsDialogContent>
      )}
    </Dialog>
  )
}

export function BotForm({
  bot,
  initialAvatarSeed,
  standalone = false,
  guard,
  onManageLibrary,
  onClose,
}: Pick<BotDialogProps, "bot"> & {
  initialAvatarSeed?: string
  standalone?: boolean
  guard: Ref<SettingsLeaveGuard>
  onManageLibrary: (tab: "skills" | "tools" | "connections") => void
  onClose: () => void
}) {
  const formId = useId()
  const [savedBot, setSavedBot] = useState(bot)
  const isEditing = !!savedBot
  const router = useRouter()
  const submitting = useRef(false)
  const [requestKey] = useState(() => nanoid())
  const [initialSeed] = useState(
    () => bot?.avatar ?? initialAvatarSeed ?? nanoid()
  )
  const [avatarSeed, setAvatarSeed] = useState(initialSeed)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const defaultValues = {
    modelChoice: bot?.modelChoice ?? null,
    skillIds: [] as string[],
    toolIds: [] as string[],
    avatar: initialSeed,
    name: bot?.name ?? "Ada",
    job: bot?.job ?? "Research assistant",
    instructions: bot?.instructions ?? (bot ? "" : defaultInstructions),
  }
  const form = useForm<BotFormValues>({
    resolver: zodResolver(botFormSchema),
    defaultValues,
  })
  const { isDirty } = form.formState
  const { requestLeave, discardDialog } = useSettingsFormGuard(
    guard,
    isDirty,
    submitting,
    "bot"
  )
  const selection = useController({ control: form.control, name: "skillIds" })
  const modelSelection = useController({
    control: form.control,
    name: "modelChoice",
  })
  const toolSelection = useController({
    control: form.control,
    name: "toolIds",
  })
  const [options, setOptions] = useState<{
    connections: ConnectionSummary[]
    skills: SkillSummary[]
    tools: ToolSummary[]
  } | null>(null)
  const [loadError, setLoadError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const botId = bot?.id
  const resetField = form.resetField
  useEffect(() => {
    let current = true
    async function load() {
      try {
        const [catalog, binding, toolCatalog, toolBinding, connections] =
          await Promise.all([
            getSkills(),
            botId ? getBotSkillIds(botId) : null,
            getTools(),
            botId ? getBotToolIds(botId) : null,
            getModelConnections(),
          ])
        if (!current) return
        if (
          !connections.success ||
          !catalog.success ||
          (binding && !binding.success) ||
          !toolCatalog.success ||
          (toolBinding && !toolBinding.success)
        )
          throw new Error()
        const ids = binding?.data ?? []
        if (ids.some((id) => !catalog.data.some((skill) => skill.id === id)))
          throw new Error()
        resetField("skillIds", { defaultValue: [...ids].sort() })
        const toolIds = toolBinding?.data ?? []
        if (toolIds.some((id) => !toolCatalog.data.some((t) => t.id === id)))
          throw new Error()
        resetField("toolIds", { defaultValue: [...toolIds].sort() })
        setOptions({
          skills: catalog.data,
          tools: toolCatalog.data,
          connections: connections.data,
        })
      } catch {
        if (current) setLoadError("Could not load bot bindings.")
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

  function onSubmit(values: BotFormValues) {
    if (!options || submitting.current || (isEditing && !isDirty)) return
    submitting.current = true
    setServerError(null)

    startTransition(async () => {
      const input = {
        ...values,
        instructions: values.instructions?.trim() || undefined,
      }
      try {
        const result = savedBot
          ? await updateBot(savedBot.id, input)
          : await createBot(input, requestKey)

        if (!result.success) {
          setServerError(result.error)
          return
        }

        if (standalone) onClose()
        else {
          setSavedBot(result.bot)
          form.reset({
            ...values,
            name: result.bot.name,
            job: result.bot.job,
            instructions: result.bot.instructions ?? "",
          })
        }
        router.refresh()
      } catch {
        setServerError("Could not save the bot. Please try again.")
      } finally {
        submitting.current = false
      }
    })
  }

  const Title = standalone ? DialogTitle : "h2"
  return (
    <>
      {(standalone || !isEditing) && (
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <Title className="type-section-title">
            {isEditing ? "Edit bot" : "New bot"}
          </Title>
          {standalone && (
            <DialogDescription className="text-xs leading-5 text-muted-foreground">
              {isEditing
                ? "Update its face, name, and job."
                : "Give it a face, a name, and a job to do."}
            </DialogDescription>
          )}
        </DialogHeader>
      )}
      <SettingsFormBody
        id={formId}
        className="flex [scrollbar-width:none] [scrollbar-gutter:auto] flex-col px-2 py-3 sm:px-4"
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      >
        <fieldset disabled={isPending} className="flex min-w-0 flex-1 flex-col">
          <FieldGroup className="flex-1 gap-3">
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
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
            </div>
            <div className="flex items-center gap-3">
              <ChatAvatar
                seed={avatarSeed}
                animated
                className="size-10 rounded-md"
              />
              <FieldTitle className="flex-1">Face</FieldTitle>
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

            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {(["Skills", "Tools"] as const).map((label) => {
                const selected = label === "Skills" ? selection : toolSelection
                return (
                  <BotBindingPicker
                    key={label}
                    label={label}
                    options={
                      (label === "Skills" ? options?.skills : options?.tools) ??
                      null
                    }
                    ids={selected.field.value}
                    onChange={selected.field.onChange}
                    disabled={isPending}
                    error={loadError}
                    validationError={selected.fieldState.error?.message}
                    onRetry={() => {
                      setLoadError("")
                      setAttempt((n) => n + 1)
                    }}
                    onManage={() =>
                      requestLeave(() =>
                        onManageLibrary(label === "Skills" ? "skills" : "tools")
                      )
                    }
                  />
                )
              })}
            </div>
            <BotModelFields
              connections={options?.connections ?? null}
              choice={modelSelection.field.value ?? null}
              onChange={modelSelection.field.onChange}
              manage={() => requestLeave(() => onManageLibrary("connections"))}
            />
            <Field
              className="flex-1"
              data-invalid={!!form.formState.errors.instructions}
            >
              <FieldLabel htmlFor="bot-instructions">
                How it should work
              </FieldLabel>
              <Textarea
                id="bot-instructions"
                placeholder={defaultInstructions}
                rows={2}
                className="field-sizing-fixed min-h-14 flex-1 resize-none overflow-y-auto overscroll-contain"
                aria-invalid={!!form.formState.errors.instructions}
                {...form.register("instructions")}
              />
              <FieldError errors={[form.formState.errors.instructions]} />
            </Field>
          </FieldGroup>
        </fieldset>

        {serverError && (
          <p className="text-sm text-destructive" role="alert">
            {serverError}
          </p>
        )}
      </SettingsFormBody>
      <SettingsFormFooter
        formId={formId}
        noun="bot"
        editing={isEditing}
        dirty={isDirty}
        pending={isPending}
        ready={
          !!options &&
          !!modelSelection.field.value &&
          !(
            modelSelection.field.value &&
            choiceProblem(
              modelSelection.field.value,
              options.connections.find(
                (c) => c.id === modelSelection.field.value?.connectionId
              )
            )
          )
        }
        onCancel={() => requestLeave(onClose)}
      >
        {savedBot && (
          <DeleteBotAction
            bot={savedBot}
            standalone={standalone}
            disabled={isPending}
            onDeleted={onClose}
          />
        )}
      </SettingsFormFooter>
      {discardDialog}
    </>
  )
}

function DeleteBotAction({
  bot,
  standalone,
  disabled,
  onDeleted,
}: {
  bot: { id: string; name: string }
  standalone?: boolean
  disabled?: boolean
  onDeleted: () => void
}) {
  const router = useRouter()
  return (
    <SettingsDeleteAction
      noun="bot"
      title={`Delete ${bot.name}?`}
      description="This permanently deletes the bot and its direct chat. This action cannot be undone."
      remove={() => deleteBot(bot.id)}
      onDeleted={(result) => {
        onDeleted()
        if (
          result.deletedChatIds.some(
            (id) => window.location.pathname === `/chats/${id}`
          )
        ) {
          router.replace("/")
        }
        router.refresh()
      }}
      standalone={standalone}
      disabled={disabled}
    />
  )
}
