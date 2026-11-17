"use client"

import { useId, useRef } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { ChatStatus } from "ai"
import { ArrowUpIcon, ChevronDownIcon, SquareIcon } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
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
import { ChatAvatar } from "@/components/chat-avatar"
import { compactChatAvatarStyles } from "@/components/ui/compact-styles"
import {
  chatComposerSchema,
  shouldSubmitChatMessage,
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
  onSubmit: (message: ChatComposerMessage) => void | Promise<void>
  status: ChatStatus
  onStop: () => void
}) {
  const inputId = useId()
  const composing = useRef(false)
  const submitting = useRef(false)
  const form = useForm<ChatComposerMessage>({
    resolver: zodResolver(chatComposerSchema),
    defaultValues: { text: "" },
    reValidateMode: "onSubmit",
  })
  const text = useWatch({ control: form.control, name: "text" })
  const busy = status === "submitted" || status === "streaming"
  const pending = form.formState.isSubmitting
  const canSend = text.trim().length > 0 && !busy && !pending
  const error = form.formState.errors.text ?? form.formState.errors.root
  const selectedBot = bots.find((bot) => bot.id === selectedBotId)
  const label = busy ? "Stop response" : "Send message"

  async function submit(message: ChatComposerMessage) {
    if (busy || submitting.current) return
    submitting.current = true
    form.clearErrors()
    // Clear only the submitted revision, preserving input typed during a reply.
    form.setValue("text", "")
    try {
      await onSubmit(message)
    } catch {
      if (!form.getValues("text")) form.setValue("text", message.text)
      form.setError("root", {
        message: "Could not send the message. Please try again.",
      })
    } finally {
      submitting.current = false
    }
  }

  return (
    <form
      aria-label="Chat message"
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
    >
      <FieldGroup>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={inputId} className="sr-only">
            Message
          </FieldLabel>
          <InputGroup variant="muted">
            <InputGroupTextarea
              {...form.register("text")}
              id={inputId}
              size="sm"
              aria-invalid={!!error}
              aria-describedby={error ? `${inputId}-error` : undefined}
              placeholder="Message your bot..."
              className="max-h-48 min-h-16 p-3"
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
