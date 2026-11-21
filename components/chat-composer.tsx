"use client"

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react"
import { useController, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { ChatStatus } from "ai"
import { ArrowUpIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group"
import {
  Attachment,
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { ImagePreview } from "@/components/image-preview"
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
import { ChatMentionInput } from "./chat-mention-input"
import { mentionTargets, type Mention } from "@/lib/chat-mentions"
import { FileTypeIcon } from "@/components/file-type-icon"
import {
  chatComposerSchema,
  attachmentRejection,
  attachmentMediaType,
  droppedWorkspaceReference,
  formatAttachmentSize,
  WORKSPACE_FILE_DRAG_TYPE,
  type ChatComposerInput,
  type ChatComposerDraft,
  type ChatComposerMessage,
} from "@/lib/chat-composer"

type ComposerBot = { id: string; name: string; avatar: string }

function isFileDrag(transfer: DataTransfer | null): transfer is DataTransfer {
  return !!transfer && (
    transfer.types.includes(WORKSPACE_FILE_DRAG_TYPE) ||
    transfer.types.includes("Files")
  )
}

function DraftImagePreview({ file }: { file: File }) {
  const [url, setUrl] = useState("")
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url]
  )
  return (
    <ImagePreview
      source={{ name: file.name, url }}
      onClose={() => setUrl("")}
      trigger={
        <AttachmentTrigger
          aria-label={`Preview ${file.name}`}
          onClick={() => setUrl(URL.createObjectURL(file))}
        />
      }
    />
  )
}

export function ChatComposer({
  bots,
  chatId,
  dropArea,
  onSubmit,
  status,
  onStop,
  textOnly = false,
}: {
  bots: ComposerBot[]
  chatId?: string
  dropArea?: RefObject<HTMLElement | null>
  onSubmit: (
    message: ChatComposerMessage
  ) => void | Promise<void | { error: string }>
  status: ChatStatus
  onStop: () => void
  textOnly?: boolean
}) {
  const inputId = useId()
  const [mentions, setMentions] = useState<Mention[]>([])
  const submitting = useRef(false)
  const formElement = useRef<HTMLFormElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const form = useForm<ChatComposerInput, unknown, ChatComposerDraft>({
    resolver: zodResolver(chatComposerSchema),
    defaultValues: { text: "", files: [] },
    reValidateMode: "onSubmit",
  })
  const { field } = useController({ control: form.control, name: "text" })
  const text = field.value
  const files = useWatch({ control: form.control, name: "files" }) ?? []
  const busy = status === "submitted" || status === "streaming"
  const pending = form.formState.isSubmitting
  const canSend =
    (text.trim().length > 0 || files.length > 0) && !busy && !pending
  const error = form.formState.errors.text ?? form.formState.errors.root
  const label = busy ? "Stop response" : "Send message"

  function addFiles(incoming: FileList | File[] | null) {
    if (!incoming) return
    if (textOnly) {
      form.setError("root", {
        message: "This chat supports text messages only.",
      })
      return
    }
    form.clearErrors("root")
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

  const acceptDrop = useEffectEvent((transfer: DataTransfer) => {
    if (!transfer.types.includes(WORKSPACE_FILE_DRAG_TYPE)) {
      addFiles(transfer.files)
      return
    }
    if (textOnly) {
      form.setError("root", { message: "This chat supports text messages only." })
      return
    }
    const result = droppedWorkspaceReference(
      transfer.getData(WORKSPACE_FILE_DRAG_TYPE),
      chatId
    )
    if ("error" in result) {
      form.setError("root", { message: result.error })
      return
    }
    form.clearErrors("root")
    if (!mentions.some((m) => m.kind === "file" && m.value === result.path)) {
      const draft = form.getValues("text")
      const prefix = draft && !/\s$/u.test(draft) ? draft + " " : draft
      const token = "@" + result.path
      const reference: Mention = {
        kind: "file",
        value: result.path,
        label: result.path,
        start: prefix.length,
        end: prefix.length + token.length,
      }
      form.setValue("text", prefix + token + " ", { shouldDirty: true })
      setMentions([...mentions, reference])
    }
    requestAnimationFrame(() => {
      const input = formElement.current?.elements.namedItem("text")
      if (input instanceof HTMLTextAreaElement) {
        input.focus({ preventScroll: true })
        input.setSelectionRange(input.value.length, input.value.length)
      }
    })
  })
  useEffect(() => {
    const area = dropArea?.current ?? formElement.current
    if (!area) return
    function dragOver(event: DragEvent) {
      const transfer = event.dataTransfer
      if (!isFileDrag(transfer)) return
      event.preventDefault()
      transfer.dropEffect = "copy"
      setDragging(true)
    }
    function dragLeave(event: DragEvent) {
      if (
        event.relatedTarget instanceof Node &&
        area?.contains(event.relatedTarget)
      )
        return
      setDragging(false)
    }
    function drop(event: DragEvent) {
      setDragging(false)
      const transfer = event.dataTransfer
      if (!isFileDrag(transfer)) return
      event.preventDefault()
      acceptDrop(transfer)
    }
    area.addEventListener("dragover", dragOver)
    area.addEventListener("dragleave", dragLeave)
    area.addEventListener("drop", drop)
    return () => {
      area.removeEventListener("dragover", dragOver)
      area.removeEventListener("dragleave", dragLeave)
      area.removeEventListener("drop", drop)
    }
  }, [dropArea])

  async function submit(message: ChatComposerDraft) {
    if (busy || submitting.current) return
    submitting.current = true
    form.clearErrors()
    // Clear only the submitted revision, preserving input typed during a reply.
    const submittedMentions = mentions
    setMentions([])
    form.setValue("text", "")
    form.setValue("files", [])
    let problem: string | undefined
    try {
      const result = await onSubmit({
        ...message,
        ...mentionTargets(submittedMentions),
      })
      problem = result?.error
    } catch {
      problem = "Could not send the message. Please try again."
    } finally {
      submitting.current = false
    }
    if (problem) {
      if (!form.getValues("text")) {
        form.setValue("text", message.text)
        setMentions(submittedMentions)
      }
      form.setValue("files", [
        ...new Set([...message.files, ...(form.getValues("files") ?? [])]),
      ])
      form.setError("root", { message: problem })
    }
  }

  return (
    <form
      ref={formElement}
      aria-label="Chat message"
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
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
                    <FileTypeIcon filename={file.name} mediaType={file.type} />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{file.name}</AttachmentTitle>
                    <AttachmentDescription>
                      {formatAttachmentSize(file.size)}
                    </AttachmentDescription>
                  </AttachmentContent>
                  {attachmentMediaType(file)?.startsWith("image/") && (
                    <DraftImagePreview file={file} />
                  )}
                  <AttachmentAction
                    className="relative z-20"
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
            <ChatMentionInput
              id={inputId}
              chatId={textOnly ? undefined : chatId}
              bots={bots}
              value={text}
              mentions={mentions}
              error={!!error}
              canSend={canSend}
              inputRef={field.ref}
              onBlur={field.onBlur}
              change={(value, references) => {
                field.onChange(value)
                setMentions(references)
              }}
            />
            <InputGroupAddon align="block-end" className="justify-between">
              <div className="flex min-w-0 items-center gap-1">
                {!textOnly && (
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
