import assert from "node:assert/strict"
import { test } from "node:test"
import {
  DocumentSessionStore,
  isDocumentDirty,
  type DocumentIO,
} from "../lib/document-session"
import type {
  DocumentTarget,
  OpenedDocument,
  DocumentResult,
  TextDocument,
} from "../lib/workspace-document"
import {
  initialDocumentRect,
  constrainDocumentRect,
} from "../lib/document-window-layout"

const a = { chatId: "a", relativePath: "docs/note.md" },
  b = { chatId: "b", relativePath: "docs/note.md" }
function data(target: DocumentTarget, content = "base"): OpenedDocument {
  return {
    ...target,
    taskName: target.chatId,
    content,
    version: "a".repeat(64),
    bom: false,
    newline: "LF",
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture(overrides: Partial<DocumentIO> = {}) {
  const writes: Parameters<DocumentIO["save"]>[0][] = []
  const reads: DocumentTarget[] = []
  const session = new DocumentSessionStore({
    read: async (target) => {
      reads.push(target)
      return { success: true, data: data(target) }
    },
    save: async (input) => {
      writes.push(input)
      return {
        success: true,
        data: { ...data(input, input.content), version: "b".repeat(64) },
      }
    },
    ...overrides,
  })
  return { session, writes, reads }
}
test("preview/source and same-file reopen keep one shared draft; undo restores clean state", async () => {
  const { session, reads } = fixture()
  await session.open(a)
  session.edit("draft")
  session.setMode("source")
  await session.open(a)
  assert.equal(reads.length, 1)
  assert.equal(session.getSnapshot().document?.buffer, "draft")
  assert.equal(session.getSnapshot().document?.mode, "source")
  assert.equal(isDocumentDirty(session.getSnapshot().document), true)
  session.edit("base")
  assert.equal(isDocumentDirty(session.getSnapshot().document), false)
})
test("switch/close/reload require a decision; cancel never changes the draft", async () => {
  const { session } = fixture()
  await session.open(a)
  session.edit("draft")
  await session.open(b)
  assert.equal(session.getSnapshot().intent?.kind, "open")
  session.cancelIntent()
  assert.equal(session.getSnapshot().document?.chatId, "a")
  session.requestClose()
  session.cancelIntent()
  session.requestReload()
  session.cancelIntent()
  assert.equal(session.getSnapshot().document?.buffer, "draft")
  await session.open(b)
  await session.resolveIntent("discard")
  assert.equal(session.getSnapshot().document?.chatId, "b")
})
test("save and continue writes the original chat identity before switching", async () => {
  const { session, writes } = fixture()
  await session.open(a)
  session.edit("draft")
  await session.open(b)
  await session.resolveIntent("save")
  assert.equal(writes[0].chatId, "a")
  assert.equal(writes[0].relativePath, a.relativePath)
  assert.equal(session.getSnapshot().document?.chatId, "b")
})
test("failed save and continue cannot close or lose a buffer", async () => {
  const { session } = fixture({
    save: async () => ({ success: false, code: "IO_ERROR", error: "offline" }),
  })
  await session.open(a)
  session.edit("draft")
  session.requestClose()
  await session.resolveIntent("save")
  assert.equal(session.getSnapshot().intent?.kind, "close")
  assert.equal(session.getSnapshot().document?.buffer, "draft")
  assert.equal(session.getSnapshot().document?.error, "offline")
})
test("typing during save acknowledges only the submitted revision; duplicate saves are ignored", async () => {
  const saved = deferred<DocumentResult<TextDocument>>()
  let count = 0
  const { session } = fixture({
    save: async () => {
      count++
      return saved.promise
    },
  })
  await session.open(a)
  session.edit("submitted")
  const saving = session.save()
  session.edit("new keystroke")
  assert.equal(await session.save(), false)
  saved.resolve({ success: true, data: data(a, "submitted") })
  assert.equal(await saving, false)
  assert.equal(count, 1)
  assert.equal(session.getSnapshot().document?.savedContent, "submitted")
  assert.equal(session.getSnapshot().document?.buffer, "new keystroke")
  assert.equal(isDocumentDirty(session.getSnapshot().document), true)
})
test("out of order reads cannot replace a newer document or reopen a closed one", async () => {
  const first = deferred<DocumentResult<OpenedDocument>>()
  const second = deferred<DocumentResult<OpenedDocument>>()
  const { session } = fixture({
    read: (target) => (target.chatId === "a" ? first.promise : second.promise),
  })
  const openA = session.open(a),
    openB = session.open(b)
  second.resolve({ success: true, data: data(b, "new") })
  await openB
  first.resolve({ success: true, data: data(a, "old") })
  await openA
  assert.equal(session.getSnapshot().document?.buffer, "new")
  assert.equal(session.getSnapshot().document?.chatId, "b")
  session.requestClose()
  assert.equal(session.getSnapshot().document, null)
})
test("deletion during loading invalidates the old response", async () => {
  const reading = deferred<DocumentResult<OpenedDocument>>()
  const { session } = fixture({ read: () => reading.promise })
  const opening = session.open(a)
  await session.prepareDeletion(a)
  session.finishDeletion(a, true)
  reading.resolve({ success: true, data: data(a, "late") })
  await opening
  assert.equal(session.getSnapshot().document?.missing, true)
  assert.equal(session.getSnapshot().document?.buffer, "")
})
test("discard before ancestor deletion is deferred; cancellation or failure keeps the draft", async () => {
  const { session } = fixture()
  await session.open(a)
  session.edit("precious")
  const target = { chatId: "a", relativePath: "docs" }
  const decision = session.prepareDeletion(target)
  assert.equal(session.getSnapshot().intent?.kind, "delete")
  await session.resolveIntent("discard")
  assert.equal(await decision, true)
  session.edit("not allowed during confirmation")
  assert.equal(session.getSnapshot().document?.buffer, "precious")
  session.finishDeletion(target, false)
  assert.equal(isDocumentDirty(session.getSnapshot().document), true)
  assert.equal(session.getSnapshot().deletion, null)
  const again = session.prepareDeletion(target)
  await session.resolveIntent("discard")
  await again
  session.finishDeletion(target, true)
  assert.equal(session.getSnapshot().document?.missing, true)
  assert.equal(session.getSnapshot().document?.buffer, "precious")
  assert.equal(await session.save(), false)
})
test("deletion of another chat or sibling never prompts for this document", async () => {
  const { session } = fixture()
  await session.open(a)
  session.edit("draft")
  assert.equal(await session.prepareDeletion(b), true)
  assert.equal(
    await session.prepareDeletion({ ...a, relativePath: "docs2" }),
    true
  )
  session.finishDeletion(b, true)
  assert.equal(session.getSnapshot().intent, null)
  assert.equal(session.getSnapshot().document?.missing, false)
})
test("conflict keeps draft; disk reload requires a discard decision", async () => {
  const { session } = fixture({
    save: async () => ({ success: false, code: "CONFLICT", error: "changed" }),
  })
  await session.open(a)
  session.edit("draft")
  await session.save()
  assert.equal(session.getSnapshot().document?.conflict, true)
  session.keepDraft()
  assert.equal(session.getSnapshot().document?.buffer, "draft")
  session.requestReload()
  assert.equal(session.getSnapshot().intent?.kind, "reload")
  session.cancelIntent()
  assert.equal(session.getSnapshot().document?.buffer, "draft")
  session.requestReload()
  await session.resolveIntent("discard")
  assert.equal(session.getSnapshot().document?.buffer, "base")
})
test("external deletion found by explicit refresh preserves text and marks missing", async () => {
  let gone = false
  const { session } = fixture({
    read: async (target) =>
      gone
        ? { success: false, code: "NOT_FOUND", error: "gone" }
        : { success: true, data: data(target) },
  })
  await session.open(a)
  session.edit("draft")
  gone = true
  await session.checkExists("a")
  assert.equal(session.getSnapshot().document?.missing, true)
  assert.equal(session.getSnapshot().document?.buffer, "draft")
})
test("closing during a read prevents late data from reopening the window", async () => {
  const reading = deferred<DocumentResult<OpenedDocument>>()
  const { session } = fixture({ read: () => reading.promise })
  const open = session.open(a)
  session.requestClose()
  reading.resolve({ success: true, data: data(a) })
  await open
  assert.equal(session.getSnapshot().document, null)
})

test("cancelling deletion during an initial read resumes loading without accepting the stale read", async () => {
  const first = deferred<DocumentResult<OpenedDocument>>()
  const second = deferred<DocumentResult<OpenedDocument>>()
  let count = 0
  const { session } = fixture({
    read: () => (++count === 1 ? first.promise : second.promise),
  })
  const opening = session.open(a)
  await session.prepareDeletion(a)
  session.finishDeletion(a, false)
  assert.equal(session.getSnapshot().document?.loading, true)
  first.resolve({ success: true, data: data(a, "old") })
  await opening
  assert.equal(session.getSnapshot().document?.buffer, "")
  second.resolve({ success: true, data: data(a, "fresh") })
  await second.promise
  assert.equal(session.getSnapshot().document?.buffer, "fresh")
})

test("oversized drafts are rejected before dispatch, preserving the buffer", async () => {
  const { session, writes } = fixture()
  await session.open(a)
  session.edit("中".repeat(100000))
  assert.equal(await session.save(), false)
  assert.equal(writes.length, 0)
  assert.match(session.getSnapshot().document!.error!, /256 KiB/)
  assert.equal(session.getSnapshot().document?.buffer.length, 100000)
})
test("layout constrains dragging/resizing, recenters initially, and fills small screens", () => {
  const desktop = { width: 1440, height: 900 }
  assert.deepEqual(initialDocumentRect(desktop), {
    x: 170,
    y: 90,
    width: 1100,
    height: 720,
  })
  const clamped = constrainDocumentRect(
    { x: -3000, y: 6000, width: 1000, height: 700 },
    desktop
  )
  assert.equal(clamped.x, 8)
  assert.equal(clamped.y, 192)
  assert.deepEqual(
    constrainDocumentRect(clamped, { width: 390, height: 844 }),
    { x: 0, y: 0, width: 390, height: 844 }
  )
})
