import assert from "node:assert/strict"
import { test } from "node:test"
import {
  chatComposerSchema,
  attachmentMediaType,
  attachmentRejection,
  chatAttachmentParts,
  legacyAttachmentReferences,
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

test("attachment context uses real message parts and recovers older file references only once", () => {
  const file = new File(["test"], "评审意见.DOCX", {
    type: "application/octet-stream",
  })
  const reference = {
    name: file.name,
    mediaType: attachmentMediaType(file)!,
    size: file.size,
    relativePath: "uploads/" + file.name,
  }
  assert.match(reference.mediaType, /wordprocessingml/)
  const legacy = {
    id: "old",
    role: "user" as const,
    parts: [
      {
        type: "text" as const,
        text:
          "Workspace attachment: " +
          JSON.stringify(reference.relativePath) +
          ". File contents are stored in the task workspace and are not included in this message.",
      },
    ],
    metadata: { workspaceFiles: { 0: reference } },
  }
  const [restored] = legacyAttachmentReferences([legacy], [])
  assert.deepEqual(restored, { ...reference, contextOnly: true })
  const { parts, workspaceFiles } = chatAttachmentParts(
    [{ reference: restored, part: { type: "text", text: "Document body" } }],
    "Follow up"
  )
  assert.deepEqual(parts, [
    { type: "text", text: "Follow up" },
    { type: "text", text: "Document body" },
  ])
  assert.equal(
    storedAttachmentSchema.parse(workspaceFiles[1]).relativePath,
    reference.relativePath
  )
  const followup = {
    id: "next",
    role: "user" as const,
    parts,
    metadata: { workspaceFiles },
  }
  assert.deepEqual(legacyAttachmentReferences([legacy, followup], []), [])
  assert.deepEqual(legacyAttachmentReferences([legacy], [reference]), [])
  assert.deepEqual(
    legacyAttachmentReferences([{ ...legacy, metadata: undefined }], []),
    []
  )
  assert.deepEqual(
    legacyAttachmentReferences([{ ...legacy, role: "assistant" }], []),
    []
  )
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
