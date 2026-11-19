"use client"

import { useId, useRef, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { ChatStatus } from "ai"
import {
  ArrowUpIcon,
  ChevronDownIcon,
  FileTextIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  Attachment,
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { ChatAvatar } from "@/components/chat-avatar"
import { compactChatAvatarStyles } from "@/components/ui/compact-styles"
import {
  chatComposerSchema,
  shouldSubmitChatMessage,
  attachmentRejection,
  formatAttachmentSize,
  type ChatComposerInput,
  type ChatComposerMessage,
} from "@/lib/chat-composer"

type ComposerBot = { id: string; name: string; avatar: string }

export function ChatComposer({
  bots,
  selectedBotId,
  onBotChange,
  onSubmit,
  status,
  onStop,
}: {
  bots: ComposerBot[]
  selectedBotId: string
  onBotChange: (id: string) => void
  onSubmit: (
    message: ChatComposerMessage
  ) => void | Promise<void | { error: string }>
  status: ChatStatus
  onStop: () => void
}) {
  const inputId = useId()
  const composing = useRef(false)
  const submitting = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const form = useForm<ChatComposerInput, unknown, ChatComposerMessage>({
    resolver: zodResolver(chatComposerSchema),
    defaultValues: { text: "", files: [] },
    reValidateMode: "onSubmit",
  })
  const text = useWatch({ control: form.control, name: "text" })
  const files = useWatch({ control: form.control, name: "files" }) ?? []
  const busy = status === "submitted" || status === "streaming"
  const pending = form.formState.isSubmitting
  const canSend =
    (text.trim().length > 0 || files.length > 0) && !busy && !pending
  const error = form.formState.errors.text ?? form.formState.errors.root
  const selectedBot = bots.find((bot) => bot.id === selectedBotId)
  const label = busy ? "Stop response" : "Send message"

  function addFiles(incoming: FileList | File[] | null) {
    if (!incoming) return
    const accepted: File[] = []
    for (const file of Array.from(incoming)) {
      const rejection = attachmentRejection(file)
      if (rejection) {
        form.setError("root", { message: `${file.name}: ${rejection}` })
        continue
      }
      accepted.push(file)
    }
    if (!accepted.length) return
    const current = form.getValues("files") ?? []
    // The same file dropped twice is one attachment, not two.
    const next = [
      ...current,
      ...accepted.filter(
        (file) =>
          !current.some(
            (existing) =>
              existing.name === file.name &&
              existing.size === file.size &&
              existing.lastModified === file.lastModified
          )
      ),
    ]
    form.setValue("files", next, { shouldDirty: true, shouldValidate: true })
  }

  function removeFile(target: File) {
    form.setValue(
      "files",
      (form.getValues("files") ?? []).filter((file) => file !== target),
      { shouldDirty: true, shouldValidate: true }
    )
  }

  async function submit(message: ChatComposerMessage) {
    if (busy || submitting.current) return
    submitting.current = true
    form.clearErrors()
    // Clear only the submitted revision, preserving input typed during a reply.
    form.setValue("text", "")
    form.setValue("files", [])
    let problem: string | undefined
    try {
      const result = await onSubmit(message)
      problem = result?.error
    } catch {
      problem = "Could not send the message. Please try again."
    } finally {
      submitting.current = false
    }
    if (problem) {
      if (!form.getValues("text")) form.setValue("text", message.text)
      form.setValue("files", message.files)
      form.setError("root", { message: problem })
    }
  }

  return (
    <form
      aria-label="Chat message"
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        // Ignore the drag leaving a child element for the form itself.
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDragging(false)
        addFiles(event.dataTransfer.files)
      }}
      className={cn(
        dragging && "rounded-2xl ring-2 ring-ring/40 ring-offset-2"
      )}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          addFiles(event.currentTarget.files)
          event.currentTarget.value = ""
        }}
      />
      <FieldGroup>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={inputId} className="sr-only">
            Message
          </FieldLabel>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((file) => (
                <Attachment
                  key={`${file.name}:${file.size}:${file.lastModified}`}
                  size="sm"
                  state="done"
                >
                  <AttachmentMedia variant="icon">
                    <FileTextIcon />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{file.name}</AttachmentTitle>
                    <AttachmentDescription>
                      {formatAttachmentSize(file.size)}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentAction
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removeFile(file)}
                  >
                    <XIcon />
                  </AttachmentAction>
                </Attachment>
              ))}
            </div>
          )}
          <InputGroup variant="composer">
            <InputGroupTextarea
              {...form.register("text")}
              id={inputId}
              size="composer"
              aria-invalid={!!error}
              aria-describedby={error ? `${inputId}-error` : undefined}
              placeholder="Message your bot..."
              className="max-h-48 min-h-13"
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
              onKeyDown={(event) => {
                if (
                  !shouldSubmitChatMessage({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    isComposing:
                      composing.current || event.nativeEvent.isComposing,
                    keyCode: event.nativeEvent.keyCode,
                  })
                )
                  return
                event.preventDefault()
                if (canSend) event.currentTarget.form?.requestSubmit()
              }}
            />
            <InputGroupAddon align="block-end" className="justify-between">
              <div className="flex min-w-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        size="icon-sm"
                        type="button"
                        aria-label="Attach files"
                        disabled={busy}
                        onClick={() => fileInput.current?.click()}
                      />
                    }
                  >
                    <PlusIcon />
                  </TooltipTrigger>
                  <TooltipContent>Attach files</TooltipContent>
                </Tooltip>
                {bots.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <InputGroupButton
                          size="sm"
                          disabled={bots.length < 2}
                          aria-label="Choose a bot"
                          className="max-w-48"
                        />
                      }
                    >
                      <span className="truncate">
                        {selectedBot?.name ?? "Choose a bot"}
                      </span>
                      <ChevronDownIcon data-icon="inline-end" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="start">
                      <DropdownMenuGroup>
                        <DropdownMenuRadioGroup
                          value={selectedBotId}
                          onValueChange={onBotChange}
                        >
                          {bots.map((bot) => (
                            <DropdownMenuRadioItem
                              key={bot.id}
                              value={bot.id}
                              closeOnClick
                            >
                              <ChatAvatar
                                seed={bot.avatar}
                                animated
                                alt={`${bot.name} avatar`}
                                className={compactChatAvatarStyles}
                              />
                              {bot.name}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      className="ml-auto"
                      size="icon-sm"
                      variant="default"
                      type={busy ? "button" : "submit"}
                      aria-label={label}
                      disabled={!busy && !canSend}
                      onClick={(event) => {
                        if (!busy) return
                        // Stop can synchronously change status and turn this
                        // same DOM button back into a submit button.
                        event.preventDefault()
                        onStop()
                      }}
                    />
                  }
                >
                  {status === "submitted" || (pending && !busy) ? (
                    <Spinner />
                  ) : busy ? (
                    <SquareIcon />
                  ) : (
                    <ArrowUpIcon />
                  )}
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
          {error && <FieldError id={`${inputId}-error`} errors={[error]} />}
        </Field>
      </FieldGroup>
    </form>
  )
}
