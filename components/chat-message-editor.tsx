"use client"

import { useId, useState } from "react"
import { useController, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { UIMessage } from "ai"
import { ChatMentionInput } from "./chat-mention-input"
import { Button } from "./ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import type { ChatSpeaker } from "@/lib/chat-presentation"
import {
  mentionPattern,
  mentionTargets,
  type Mention,
} from "@/lib/chat-mentions"
import { editMessageFields, type ReviseMessage } from "@/lib/chat-revision"

export function ChatMessageEditor({
  message,
  text,
  bots,
  hasFiles,
  disabled,
  revise,
  close,
}: {
  message: UIMessage
  text: string
  bots: ChatSpeaker[]
  hasFiles: boolean
  disabled: boolean
  revise: ReviseMessage
  close: () => void
}) {
  const id = useId()
  const form = useForm({
    defaultValues: { text },
    resolver: zodResolver(editMessageFields),
  })
  const { field } = useController({ control: form.control, name: "text" })
  const [mentions, setMentions] = useState<Mention[]>(() => {
    const ids =
      (message.metadata as { mentionedBotIds?: string[] })?.mentionedBotIds ??
      []
    const original = ids.flatMap((id) => bots.filter((bot) => bot.id === id))
    if (!original.length) return []
    return Array.from(
      text.matchAll(mentionPattern(original.map((bot) => bot.name))),
      (match) => ({
        kind: "bot",
        label: match[1],
        value: original.find((bot) => bot.name === match[1])!.id,
        start: match.index,
        end: match.index + match[0].length,
      })
    )
  })
  const problem = form.formState.errors.text ?? form.formState.errors.root
  const pending = form.formState.isSubmitting
  return (
    <form
      className="w-full"
      aria-label="Edit message"
      onSubmit={form.handleSubmit(async ({ text }) => {
        if (disabled || (!text.trim() && !hasFiles)) return
        const result = await revise(message, {
          action: "edit",
          text,
          mentionedBotIds: mentionTargets(mentions).mentionedBotIds,
        })
        if (result?.error) form.setError("root", { message: result.error })
        else close()
      })}
    >
      <FieldGroup className="gap-2">
        <Field data-invalid={!!problem}>
          <FieldLabel htmlFor={id} className="sr-only">
            Message text
          </FieldLabel>
          <div className="relative">
            <ChatMentionInput
              id={id}
              bots={bots}
              fieldLabel="Message text"
              value={field.value}
              mentions={mentions}
              maxLength={120000}
              error={!!problem}
              inputRef={field.ref}
              onBlur={field.onBlur}
              change={(value, next) => {
                field.onChange(value)
                setMentions(next)
              }}
            />
          </div>
          {problem && (
            <FieldError id={id + "-error"}>{problem.message}</FieldError>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={disabled || pending || (!field.value.trim() && !hasFiles)}
          >
            Save and resend
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
