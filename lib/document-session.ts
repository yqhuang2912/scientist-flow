import {
  sameDocument,
  saveDocumentSchema,
  type DocumentTarget,
  type DocumentResult,
  type OpenedDocument,
  type TextDocument,
  type SaveDocumentInput,
} from "./workspace-document"
import { workspaceOpenPolicy } from "./workspace-open-policy"

export type DocumentSession = DocumentTarget & {
  taskName: string
  savedContent: string
  buffer: string
  version: string
  bom: boolean
  newline: TextDocument["newline"]
  truncated?: boolean
  readOnly?: boolean
  loading: boolean
  saving: boolean
  error: string | null
  conflict: boolean
  missing: boolean
  mode: "preview" | "source"
  saved: boolean
}
type Intent =
  | { kind: "close" | "reload" | "delete" }
  | { kind: "open"; target: DocumentTarget }
export type DocumentSessionState = {
  document: DocumentSession | null
  intent: Intent | null
  deletion: DocumentTarget | null
  activation: number
}
export interface DocumentIO {
  read(target: DocumentTarget): Promise<DocumentResult<OpenedDocument>>
  save(input: SaveDocumentInput): Promise<DocumentResult<TextDocument>>
}
export const isDocumentDirty = (document: DocumentSession | null) =>
  !!document && document.buffer !== document.savedContent
export function documentWithin(
  document: DocumentTarget,
  target: DocumentTarget
) {
  return (
    document.chatId === target.chatId &&
    (document.relativePath === target.relativePath ||
      document.relativePath.startsWith(`${target.relativePath}/`))
  )
}

/** Framework-independent session store. Layout and the chat runtime are not part of it. */
export class DocumentSessionStore {
  private state: DocumentSessionState = {
    document: null,
    intent: null,
    deletion: null,
    activation: 0,
  }
  private listeners = new Set<() => void>()
  private sequence = 0
  private deleteDecision: ((allowed: boolean) => void) | null = null
  private deleteTarget: DocumentTarget | null = null
  constructor(private io: DocumentIO) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(patch: Partial<DocumentSessionState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  private patchDocument(patch: Partial<DocumentSession>) {
    if (this.state.document)
      this.update({ document: { ...this.state.document, ...patch } })
  }
  activate = () => this.update({ activation: this.state.activation + 1 })
  edit = (buffer: string) => {
    if (
      this.state.intent ||
      this.state.deletion ||
      this.state.document?.readOnly ||
      this.state.document?.loading
    )
      return
    this.patchDocument({ buffer, saved: false })
  }
  setMode = (mode: DocumentSession["mode"]) => this.patchDocument({ mode })
  keepDraft = () => this.patchDocument({ error: null })
  open = async (target: DocumentTarget) => {
    if (this.state.intent || this.state.deletion) {
      this.activate()
      return
    }
    if (this.state.document && sameDocument(this.state.document, target)) {
      this.activate()
      return
    }
    if (this.state.document?.saving) return
    if (isDocumentDirty(this.state.document)) {
      this.update({ intent: { kind: "open", target } })
      this.activate()
      return
    }
    await this.load(target)
  }
  private async load(target: DocumentTarget, reloading = false) {
    const request = ++this.sequence
    const old = this.state.document
    const policy = workspaceOpenPolicy(target.relativePath)
    if (policy.kind !== "internal-text" && policy.kind !== "data-json-preview")
      return
    const document: DocumentSession =
      reloading && old
        ? { ...old, loading: true, error: null }
        : {
            ...target,
            taskName: target.chatId,
            buffer: "",
            savedContent: "",
            version: "",
            bom: false,
            newline: "LF",
            loading: true,
            saving: false,
            error: null,
            conflict: false,
            missing: false,
            // Only markdown has a second form to show, so it opens rendered.
            // Every other file opens on its editing surface.
            mode:
              policy.kind === "internal-text" && policy.markdown
                ? "preview"
                : "source",
            readOnly: policy.kind === "data-json-preview",
            saved: false,
          }
    this.update({
      document,
      intent: null,
      activation: this.state.activation + 1,
    })
    try {
      const result = await this.io.read({
        chatId: target.chatId,
        relativePath: target.relativePath,
      })
      if (request !== this.sequence) return
      if (!result.success) {
        this.patchDocument({
          loading: false,
          error: result.error,
          missing: result.code === "NOT_FOUND",
          conflict: result.code === "CONFLICT",
        })
        return
      }
      const data = result.data
      this.patchDocument({
        ...data,
        savedContent: data.content,
        buffer: data.content,
        loading: false,
        saving: false,
        error: null,
        conflict: false,
        missing: false,
        saved: false,
      })
    } catch {
      if (request === this.sequence)
        this.patchDocument({
          loading: false,
          error: "Could not read the file. Please retry.",
        })
    }
  }
  save = async (): Promise<boolean> => {
    const document = this.state.document
    if (
      !document ||
      document.readOnly ||
      document.loading ||
      document.saving ||
      document.missing ||
      document.conflict ||
      this.state.deletion ||
      !document.version
    )
      return false
    if (!isDocumentDirty(document)) return true
    const input = saveDocumentSchema.safeParse({
      chatId: document.chatId,
      relativePath: document.relativePath,
      content: document.buffer,
      baseVersion: document.version,
    })
    if (!input.success) {
      this.patchDocument({ error: input.error.issues[0].message })
      return false
    }
    const request = ++this.sequence
    const submitted = document.buffer
    this.patchDocument({ saving: true, error: null })
    try {
      const result = await this.io.save({
        chatId: document.chatId,
        relativePath: document.relativePath,
        content: submitted,
        baseVersion: document.version,
      })
      if (request !== this.sequence) return false
      if (!result.success) {
        this.patchDocument({
          saving: false,
          error: result.error,
          conflict: result.code === "CONFLICT",
          missing: result.code === "NOT_FOUND",
        })
        return false
      }
      // A later keystroke remains dirty. Never replace the buffer on save success.
      this.patchDocument({
        savedContent: result.data.content,
        version: result.data.version,
        bom: result.data.bom,
        newline: result.data.newline,
        saving: false,
        saved: true,
        error: null,
      })
      return !isDocumentDirty(this.state.document)
    } catch {
      if (request === this.sequence)
        this.patchDocument({
          saving: false,
          error: "Could not save the file. Your draft has been kept.",
        })
      return false
    }
  }
  requestClose = () => this.request({ kind: "close" })
  requestReload = () => this.request({ kind: "reload" })
  private request(intent: Intent) {
    if (
      !this.state.document ||
      this.state.intent ||
      this.state.deletion ||
      this.state.document.saving
    )
      return
    if (isDocumentDirty(this.state.document)) this.update({ intent })
    else void this.continue(intent)
  }
  cancelIntent = () => {
    this.update({ intent: null })
    this.deleteDecision?.(false)
    this.deleteDecision = null
    this.deleteTarget = null
  }
  resolveIntent = async (choice: "save" | "discard") => {
    const intent = this.state.intent
    if (!intent || this.state.document?.saving) return
    if (choice === "save" && !(await this.save())) return
    await this.continue(intent)
  }
  private async continue(intent: Intent) {
    this.update({ intent: null })
    if (intent.kind === "close") {
      ++this.sequence
      this.update({ document: null })
      return
    }
    if (intent.kind === "open") {
      await this.load(intent.target)
      return
    }
    if (intent.kind === "reload" && this.state.document) {
      // Keep the buffer until a new read succeeds, including after explicit discard.
      await this.load(this.state.document, true)
      return
    }
    if (intent.kind === "delete") {
      // Discard is deferred: cancelling/failing the subsequent delete preserves the buffer.
      this.update({ deletion: this.deleteTarget })
      this.deleteDecision?.(true)
      this.deleteDecision = null
      this.deleteTarget = null
    }
  }
  prepareDeletion = (target: DocumentTarget): Promise<boolean> => {
    const document = this.state.document
    if (!document || !documentWithin(document, target))
      return Promise.resolve(true)
    if (this.state.intent || this.state.deletion || document.saving)
      return Promise.resolve(false)
    if (!isDocumentDirty(document)) {
      ++this.sequence // Invalidate a pending read before the deletion dialog opens.
      this.patchDocument({ loading: false })
      this.update({ deletion: target })
      return Promise.resolve(true)
    }
    this.deleteTarget = target
    this.update({ intent: { kind: "delete" } })
    this.activate()
    return new Promise((resolve) => {
      this.deleteDecision = resolve
    })
  }
  finishDeletion = (target: DocumentTarget, deleted: boolean) => {
    if (this.deleteTarget && sameDocument(this.deleteTarget, target))
      this.cancelIntent()
    if (
      deleted &&
      this.state.document &&
      documentWithin(this.state.document, target)
    ) {
      ++this.sequence
      this.patchDocument({
        loading: false,
        saving: false,
        missing: true,
        error:
          "This file has been deleted. Its contents are still available here.",
        saved: false,
      })
    }
    if (this.state.deletion && sameDocument(this.state.deletion, target)) {
      this.update({ deletion: null })
      const doc = this.state.document
      if (!deleted && doc && !doc.version && !doc.missing && !doc.loading)
        void this.load(doc, true)
    }
  }
  /** Explicit tree refresh / partial deletion: inspect without replacing the draft. */
  checkExists = async (chatId: string) => {
    const document = this.state.document
    if (
      !document ||
      document.chatId !== chatId ||
      document.loading ||
      document.saving
    )
      return
    const request = this.sequence
    try {
      const result = await this.io.read({
        chatId: document.chatId,
        relativePath: document.relativePath,
      })
      if (
        request === this.sequence &&
        !result.success &&
        result.code === "NOT_FOUND"
      )
        this.finishDeletion(document, true)
    } catch {
      /* A failed existence check is not evidence of deletion. */
    }
  }
}
