"use client"

import { useState, useTransition } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"

import { createGroupChat } from "@/actions/chat"
import { ChatAvatar } from "@/components/chat-avatar"
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
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { groupChatFormSchema, type GroupChatFormValues } from "@/db/schema"
import type { BotSummary } from "@/queries/bots"

interface GroupChatDialogProps {
  bots: BotSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GroupChatDialog({
  bots,
  open,
  onOpenChange,
}: GroupChatDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<GroupChatFormValues>({
    resolver: zodResolver(groupChatFormSchema),
    defaultValues: { name: "", botIds: [] },
  })

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (nextOpen) {
      form.reset({ name: "", botIds: [] })
    } else {
      setServerError(null)
    }
  }

  function onSubmit(values: GroupChatFormValues) {
    setServerError(null)
    startTransition(async () => {
      const result = await createGroupChat(values)
      if (!result.success) {
        setServerError(result.error)
        return
      }

      onOpenChange(false)
      router.push(`/chats/${result.chat.id}`)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="dark max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-4 pb-0 sm:max-w-lg">
        <DialogHeader className="gap-1">
          <DialogTitle>New group chat</DialogTitle>
          <DialogDescription>
            Name the group and pick which bots are in it.
          </DialogDescription>
        </DialogHeader>

        <form
          id="group-chat-form"
          className="flex flex-col gap-5 pt-5 pb-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FieldGroup className="gap-5">
            <Field data-invalid={!!form.formState.errors.name}>
              <FieldLabel htmlFor="group-chat-name">Name</FieldLabel>
              <Input
                id="group-chat-name"
                placeholder="Weekend plans"
                aria-invalid={!!form.formState.errors.name}
                {...form.register("name")}
              />
              <FieldError errors={[form.formState.errors.name]} />
            </Field>

            <Controller
              control={form.control}
              name="botIds"
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel>Bots</FieldLabel>
                  <FieldDescription>
                    Pick at least one bot for this conversation.
                  </FieldDescription>
                  <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pt-1">
                    {bots.map((bot) => {
                      const checked = field.value.includes(bot.id)
                      return (
                        <label
                          key={bot.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => {
                              const nextValue =
                                value === true
                                  ? [...field.value, bot.id]
                                  : field.value.filter((id) => id !== bot.id)
                              field.onChange(nextValue)
                            }}
                          />
                          <ChatAvatar
                            seed={bot.avatar}
                            animated
                            alt={`${bot.name} avatar`}
                            className="size-8 rounded-lg"
                          />
                          <span className="truncate text-sm font-medium">
                            {bot.name}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
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
          <Button
            type="submit"
            form="group-chat-form"
            disabled={isPending || bots.length === 0}
          >
            {isPending && <Spinner data-icon="inline-start" />}
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
