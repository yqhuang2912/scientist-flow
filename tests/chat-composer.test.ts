import assert from "node:assert/strict"
import { test } from "node:test"
import {
  chatComposerSchema,
  attachmentMediaType,
  attachmentRejection,
  chatAttachmentParts,
  inlineAttachmentFlags,
  storedAttachmentSchema,
  shouldSubmitChatMessage,
} from "../lib/chat-composer"
import {
  MAX_UPLOAD_BYTES,
  uploadWorkspaceFileSchema,
} from "../lib/workspace-validation"

test("both pickers accept exactly 200 MB and reject the next byte", () => {
  for (const size of [MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES + 1]) {
    const file = { name: "答辩.pptx", size, type: "" } as File
    assert.equal(attachmentRejection(file) === undefined, size === 200_000_000)
    assert.equal(
      uploadWorkspaceFileSchema.safeParse(file).success,
      size === 200_000_000
    )
  }
  assert.equal(
    attachmentRejection(new File(["test"], "notes.constructor")),
    "This file type cannot be attached."
  )
})

test("Office and large PDFs stay as durable, compact chat references", async () => {
  const office = new File(["test"], "评审意见.DOCX", {
    type: "application/octet-stream",
  })
  const pdf = {
    name: "2_医学成像的基本原理.pdf",
    type: "",
    size: 64_411_588,
  } as File
  assert.match(attachmentMediaType(office)!, /wordprocessingml/)
  const files = [office, pdf]
  const entries = files.map((f) => ({
    name: f.name,
    size: f.size,
    isFile: true as const,
    isDir: false as const,
    relPath: "uploads/" + f.name,
  }))
  const { parts, workspaceFiles } = await chatAttachmentParts(
    files,
    entries,
    "Review"
  )
  assert.equal(parts[0].type, "text")
  assert.equal(parts[1].type, "text")
  assert.equal(parts[2].type, "text")
  assert.equal(
    storedAttachmentSchema.parse(workspaceFiles[2]).relativePath,
    entries[1].relPath
  )
  assert.ok(JSON.stringify({ parts, workspaceFiles }).length < 1500)
  const image = { name: "a.png", size: 210_000, type: "image/png" } as File
  assert.deepEqual(inlineAttachmentFlags([office, image, image]), [
    false,
    true,
    false,
  ])
})

test("a chat draft rejects blank messages without rewriting valid text", () => {
  for (const text of ["", " ", "\n\t"]) {
    assert.equal(chatComposerSchema.safeParse({ text }).success, false)
  }
  const text = "  中文 draft\n  indented code  "
  assert.equal(chatComposerSchema.parse({ text }).text, text)
})

test("Enter sends, while Shift+Enter and IME confirmation do not", () => {
  const event = { key: "Enter", shiftKey: false, isComposing: false }
  assert.equal(shouldSubmitChatMessage(event), true)
  assert.equal(shouldSubmitChatMessage({ ...event, shiftKey: true }), false)
  assert.equal(shouldSubmitChatMessage({ ...event, isComposing: true }), false)
  assert.equal(shouldSubmitChatMessage({ ...event, keyCode: 229 }), false)
  assert.equal(shouldSubmitChatMessage({ ...event, key: "Escape" }), false)
})
