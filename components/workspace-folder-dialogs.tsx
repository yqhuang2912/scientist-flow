"use client"

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  FolderIcon,
  FileIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import {
  createWorkspaceDirectoryAction,
  deleteWorkspaceDirectoryAction,
  inspectWorkspaceDirectoryForDeletionAction,
  createWorkspaceFileAction,
  deleteWorkspaceFileAction,
  inspectWorkspaceFileForDeletionAction,
} from "@/actions/workspace"
import {
  createWorkspaceDirectorySchema,
  createWorkspaceFileSchema,
  deleteWorkspaceDirectorySchema,
  type DirectoryDeletionConfirmation,
  type DirectoryDeletionInspection,
  type WorkspaceEntry,
  type FileDeletionInspection,
} from "@/lib/workspace-validation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useWorkspaceDocument } from "@/components/workspace-document-provider"
import type { DocumentTarget } from "@/lib/workspace-document"

function useDocumentDeletion(
  target: DocumentTarget,
  submitting: React.RefObject<boolean>
) {
  const { session } = useWorkspaceDocument()
  const { chatId, relativePath } = target
  useEffect(
    () => () => {
      if (!submitting.current)
        session.finishDeletion({ chatId, relativePath }, false)
    },
    [session, chatId, relativePath, submitting]
  )
  return session
}

const creationErrors: Record<string, string> = {
  CONFLICT: "A file or folder with this name already exists.",
  NOT_FOUND: "The destination folder no longer exists.",
  INACCESSIBLE: "Cannot access this folder. Check permissions and try again.",
  INVALID: "The name or path is invalid or too long.",
  UNSAFE_PATH: "The destination must be inside this task's workspace.",
  LINK: "Cannot create items through a symbolic link or junction.",
  NOT_DIRECTORY: "The destination is not a folder.",
  CHANGED: "The destination has changed. Reopen this dialog and try again.",
}

function useDialogLifetime() {
  const mounted = useRef(true)
  const submitting = useRef(false)
  const composing = useRef(false)
  const compositionEnded = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const isComposing = () =>
    composing.current || Date.now() - compositionEnded.current < 50
  return {
    mounted,
    submitting,
    isComposing,
    beginSubmit: () => {
      submitting.current = true
    },
    endSubmit: () => {
      submitting.current = false
    },
    compositionProps: {
      onCompositionStart: () => {
        composing.current = true
      },
      onCompositionEnd: () => {
        composing.current = false
        compositionEnded.current = Date.now()
      },
      onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => {
        if (
          event.key === "Enter" &&
          (isComposing() ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229)
        )
          event.preventDefault()
      },
    },
  }
}

export function CreateWorkspaceEntryDialog({
  kind,
  target,
  onClose,
  onStart,
  onCreated,
  onSettled,
}: {
  kind: "directory" | "file"
  target: { chatId: string; relativePath: string }
  onClose: () => void
  onStart: (relative: string) => void
  onCreated: (entry: WorkspaceEntry) => void
  onSettled: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const life = useDialogLifetime()
  const inputRef = useRef<HTMLInputElement>(null)
  const isFile = kind === "file"
  const parentDirectory = target.relativePath
    ? `root: ${target.relativePath}/`
    : "root: /"
  const EntryIcon = isFile ? FileIcon : FolderIcon
  const form = useForm<{ name: string }>({
    resolver: zodResolver(
      isFile ? createWorkspaceFileSchema : createWorkspaceDirectorySchema
    ),
    defaultValues: { name: "" },
  })
  const name = form.register("name")
  const submit = form.handleSubmit(({ name }) => {
    if (life.submitting.current || life.isComposing()) return
    life.beginSubmit()
    setError(null)
    onStart(target.relativePath ? `${target.relativePath}/${name}` : name)
    startTransition(async () => {
      let completed = false
      try {
        const createAction = isFile
          ? createWorkspaceFileAction
          : createWorkspaceDirectoryAction
        const result = await createAction(
          target.chatId,
          target.relativePath,
          name
        )
        if (!life.mounted.current) return
        if (result.success) {
          completed = true
          onCreated(result.entry)
        } else
          setError(
            creationErrors[result.code] ??
              "Could not create this item. Refresh the workspace and try again."
          )
      } catch {
        if (life.mounted.current)
          setError(
            "The request failed. Refresh the workspace to check its status before retrying."
          )
      } finally {
        life.endSubmit()
        if (life.mounted.current && !completed) onSettled()
      }
    })
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !life.submitting.current && !life.isComposing()) onClose()
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-md"
        showCloseButton={false}
        initialFocus={inputRef}
      >
        <DialogHeader className="gap-1 px-4 pt-4">
          <div className="flex items-center gap-2">
            <EntryIcon className="size-4 shrink-0" aria-hidden="true" />
            <DialogTitle>{isFile ? "New file" : "New folder"}</DialogTitle>
          </div>
          <DialogDescription className="min-w-0 font-mono text-xs leading-5 [overflow-wrap:anywhere]">
            {parentDirectory.split(/(?<=[\\/])/).map((part, index) => (
              <Fragment key={index}>
                {part}
                <wbr />
              </Fragment>
            ))}
          </DialogDescription>
        </DialogHeader>
        <form
          id="workspace-create-folder"
          className="p-4"
          onSubmit={submit}
          {...life.compositionProps}
        >
          <FieldGroup className="gap-0">
            <Field
              className="min-w-0 gap-1.5"
              data-invalid={!!form.formState.errors.name}
            >
              <FieldLabel htmlFor="workspace-folder-name">Name</FieldLabel>
              <Input
                id="workspace-folder-name"
                autoComplete="off"
                placeholder={isFile ? "e.g. notes.md" : "e.g. research"}
                disabled={pending}
                aria-invalid={!!form.formState.errors.name}
                aria-describedby={
                  form.formState.errors.name
                    ? "workspace-folder-name-error"
                    : undefined
                }
                {...name}
                ref={(element) => {
                  name.ref(element)
                  inputRef.current = element
                }}
              />
              <FieldError
                id="workspace-folder-name-error"
                errors={[form.formState.errors.name]}
              />
            </Field>
            {error && (
              <Alert variant="destructive" className="mt-3">
                <TriangleAlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </form>
        <DialogFooter className="mx-0 mb-0 flex-row justify-end rounded-b-3xl border-t px-4 py-3">
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="workspace-create-folder"
            type="submit"
            disabled={pending}
            className="sm:min-w-24"
          >
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteWorkspaceFileDialog({
  target,
  initialInspection,
  onClose,
  onStart,
  onDeleted,
  onReconcile,
  onSettled,
}: {
  target: { chatId: string; relativePath: string }
  initialInspection: FileDeletionInspection
  onClose: () => void
  onStart: (relative: string) => void
  onDeleted: (alreadyGone: boolean) => void
  onReconcile: () => Promise<void>
  onSettled: () => void
}) {
  const [inspection, setInspection] = useState<FileDeletionInspection | null>(
    initialInspection
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const life = useDialogLifetime()
  const documentSession = useDocumentDeletion(target, life.submitting)

  async function recheck() {
    await onReconcile()
    const result = await inspectWorkspaceFileForDeletionAction(
      target.chatId,
      target.relativePath
    )
    if (!life.mounted.current) return
    if (result.success) setInspection(result.inspection)
    else if (result.code === "NOT_FOUND") onDeleted(true)
    else setError(result.error)
  }

  function submit() {
    if (!inspection || life.submitting.current) return
    life.beginSubmit()
    onStart(target.relativePath)
    setError(null)
    startTransition(async () => {
      let completed = false
      try {
        const result = await deleteWorkspaceFileAction(
          target.chatId,
          target.relativePath,
          {
            confirmed: true,
            identity: inspection.identity,
          }
        )
        if (result.success || result.code === "NOT_FOUND")
          documentSession.finishDeletion(target, true)
        else void documentSession.checkExists(target.chatId)
        if (!life.mounted.current) return
        if (result.success || result.code === "NOT_FOUND") {
          completed = true
          onDeleted(!result.success)
          return
        }
        setError(result.error)
        setInspection(null)
        await recheck()
      } catch {
        void documentSession.checkExists(target.chatId)
        if (!life.mounted.current) return
        setError("删除请求失败，请重新读取文件状态后确认。")
        setInspection(null)
        await onReconcile()
      } finally {
        life.endSubmit()
        if (!life.mounted.current) documentSession.finishDeletion(target, false)
        if (life.mounted.current && !completed) onSettled()
      }
    })
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !life.submitting.current && !pending) onClose()
      }}
    >
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-x-hidden overflow-y-auto p-0 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg"
        initialFocus={cancelRef}
      >
        <AlertDialogHeader className="place-items-start gap-1.5 px-4 pt-4 pb-0 text-left">
          <div className="flex items-center gap-2">
            <Trash2Icon
              className="size-4 text-destructive"
              aria-hidden="true"
            />
            <AlertDialogTitle>删除文件？</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            删除前，请核对文件名称与所在位置。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="mx-4 mt-3 flex min-w-0 items-start gap-2.5 rounded-xl bg-muted px-2.5 py-2">
          <FileIcon
            className="mt-px size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[13px] font-medium break-all">
              {initialInspection.name}
            </p>
            <p className="font-mono text-[11px] leading-relaxed break-all text-muted-foreground">
              {target.relativePath}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>此操作无法撤销</AlertTitle>
            <AlertDescription>
              将永久删除此文件，不进入回收站。
            </AlertDescription>
          </Alert>
          {error && <FieldError>{error}</FieldError>}
          {!inspection && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    await recheck()
                  } catch {
                    if (life.mounted.current)
                      setError("无法读取文件状态，请重试。")
                  }
                })
              }}
            >
              重新读取文件状态
            </Button>
          )}
        </div>
        <AlertDialogFooter className="mx-0 mb-0 rounded-b-3xl border-t px-4 py-3">
          <Button
            ref={cancelRef}
            variant="outline"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !inspection}
            onClick={submit}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? "处理中…" : "删除"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DeleteWorkspaceFolderDialog({
  target,
  initialInspection,
  onClose,
  onStart,
  onDeleted,
  onReconcile,
  onSettled,
}: {
  target: { chatId: string; relativePath: string }
  initialInspection: DirectoryDeletionInspection
  onClose: () => void
  onStart: (relative: string) => void
  onDeleted: (alreadyGone: boolean) => void
  onReconcile: () => Promise<void>
  onSettled: () => void
}) {
  const [inspection, setInspection] =
    useState<DirectoryDeletionInspection | null>(initialInspection)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const life = useDialogLifetime()
  const documentSession = useDocumentDeletion(target, life.submitting)
  const toConfirmation = (
    value: DirectoryDeletionInspection
  ): DirectoryDeletionConfirmation =>
    value.isEmpty
      ? { mode: "empty", identity: value.identity }
      : { mode: "recursive", identity: value.identity, name: "" }
  const form = useForm<DirectoryDeletionConfirmation>({
    resolver: zodResolver(deleteWorkspaceDirectorySchema),
    defaultValues: toConfirmation(initialInspection),
  })
  const enteredName = useWatch({ control: form.control, name: "name" })
  const nameError = form.getFieldState("name", form.formState).error

  async function recheck() {
    const result = await inspectWorkspaceDirectoryForDeletionAction(
      target.chatId,
      target.relativePath
    )
    if (!life.mounted.current) return
    if (result.success) {
      setInspection(result.inspection)
      form.reset(toConfirmation(result.inspection))
    } else if (result.code === "NOT_FOUND") onDeleted(true)
    else {
      setInspection(null)
      setError(result.error)
    }
  }

  const submit = form.handleSubmit((confirmation) => {
    if (!inspection || life.submitting.current || life.isComposing()) return
    if (
      confirmation.mode === "recursive" &&
      confirmation.name !== inspection.name
    ) {
      form.setError("name", { message: "请输入完全一致的文件夹名称。" })
      return
    }
    life.beginSubmit()
    setError(null)
    onStart(target.relativePath)
    startTransition(async () => {
      let completed = false
      try {
        const result = await deleteWorkspaceDirectoryAction(
          target.chatId,
          target.relativePath,
          confirmation
        )
        if (result.success || result.code === "NOT_FOUND")
          documentSession.finishDeletion(target, true)
        else void documentSession.checkExists(target.chatId)
        if (!life.mounted.current) return
        if (result.success || result.code === "NOT_FOUND") {
          completed = true
          onDeleted(!result.success)
          return
        }
        setError(
          `${result.error}${confirmation.mode === "recursive" ? " 部分内容可能已删除，无法回滚；请核对更新后的目录并重新确认。" : ""}`
        )
        setInspection(null)
        await onReconcile()
        await recheck()
      } catch {
        void documentSession.checkExists(target.chatId)
        if (!life.mounted.current) return
        setError("删除请求失败，部分内容可能已删除。请重新读取目录状态后确认。")
        setInspection(null)
        await onReconcile()
      } finally {
        life.endSubmit()
        if (!life.mounted.current) documentSession.finishDeletion(target, false)
        if (life.mounted.current && !completed) onSettled()
      }
    })
  })
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !life.submitting.current && !life.isComposing()) onClose()
      }}
    >
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-x-hidden overflow-y-auto p-0 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg"
        initialFocus={cancelRef}
      >
        <AlertDialogHeader className="place-items-start gap-1.5 px-4 pt-4 pb-0 text-left">
          <div className="flex items-center gap-2">
            <Trash2Icon
              className="size-4 text-destructive"
              aria-hidden="true"
            />
            <AlertDialogTitle>删除文件夹？</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            删除前，请核对文件夹位置与删除范围。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="mx-4 mt-3 flex min-w-0 items-start gap-2.5 rounded-xl bg-muted px-2.5 py-2">
          <FolderIcon
            className="mt-px size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-[13px] font-medium break-all">
              {initialInspection.name}
            </p>
            <p className="font-mono text-[11px] leading-relaxed break-all text-muted-foreground">
              {target.relativePath}/
            </p>
            {inspection && (
              <Badge variant="secondary" className="mt-0.5 w-fit text-[10px]">
                {inspection.isEmpty ? "空文件夹" : "包含内容"}
              </Badge>
            )}
          </div>
        </div>
        <div className="px-4 pt-3">
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>此操作无法撤销</AlertTitle>
            <AlertDescription>
              {inspection
                ? inspection.isEmpty
                  ? "将永久删除此空文件夹，不进入回收站。如果目录内容变化，需要重新确认。"
                  : "将永久删除此文件夹及其全部子文件夹和文件，不进入回收站。"
                : "请重新读取目录状态后确认删除范围。"}
            </AlertDescription>
          </Alert>
        </div>
        <form
          id="workspace-delete-folder"
          className="px-4 pt-3 pb-4"
          onSubmit={submit}
          {...life.compositionProps}
        >
          <FieldGroup>
            {inspection && !inspection.isEmpty && (
              <Field data-invalid={!!nameError}>
                <FieldLabel
                  htmlFor="workspace-delete-name"
                  className="break-all"
                >
                  输入文件夹名称以确认
                </FieldLabel>
                <Input
                  id="workspace-delete-name"
                  autoComplete="off"
                  placeholder={inspection?.name}
                  disabled={pending}
                  aria-invalid={!!nameError}
                  aria-describedby={
                    nameError
                      ? "workspace-delete-name-error"
                      : "workspace-delete-name-help"
                  }
                  {...form.register("name")}
                />
                <FieldDescription
                  id="workspace-delete-name-help"
                  className="break-all"
                >
                  请完整输入“{inspection.name}”，包括空格与大小写。
                </FieldDescription>
                <FieldError
                  id="workspace-delete-name-error"
                  errors={[nameError]}
                />
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
            {!inspection && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await onReconcile()
                      await recheck()
                    } catch {
                      if (life.mounted.current)
                        setError("无法读取目录状态，请重试。")
                    }
                  })
                }
              >
                重新读取目录状态
              </Button>
            )}
          </FieldGroup>
        </form>
        <AlertDialogFooter className="mx-0 mb-0 rounded-b-3xl border-t px-4 py-3">
          <Button
            ref={cancelRef}
            variant="outline"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            form="workspace-delete-folder"
            type="submit"
            variant="destructive"
            disabled={
              pending ||
              !inspection ||
              (!inspection.isEmpty && enteredName !== inspection.name)
            }
          >
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? "处理中…" : "删除"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
