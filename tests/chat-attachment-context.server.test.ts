import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
  realpath,
  stat,
  symlink,
} from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { test } from "node:test"
import sharp from "sharp"
import { prepareSavedAttachments } from "../lib/chat-attachment-context.server"
import {
  attachmentMediaType,
  chatAttachmentParts,
  storedAttachmentSchema,
} from "../lib/chat-composer"
import { publicModelHistory } from "../lib/bot-execution"

test("prepared messages contain actual slide, Word, spreadsheet and PDF text and model-ready image bytes", async (t) => {
  const taskDir = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "sf-attachment-test-")
  )
  t.after(() => rm(taskDir, { recursive: true, force: true }))
  const uploads = path.join(taskDir, "uploads")
  await mkdir(uploads)
  const names = ["notes.docx", "deck.pptx", "table.xlsx", "article.pdf"]
  for (const name of names)
    await copyFile(
      new URL("./fixtures/attachments/" + name, import.meta.url),
      path.join(uploads, name)
    )
  const img = sharp({
    create: { width: 1800, height: 1200, channels: 3, background: "#1538ed" },
  })
  await img.png().toFile(path.join(uploads, "figure.png"))
  await writeFile(path.join(uploads, "long.txt"), "文".repeat(20_000))
  const refs = await Promise.all(
    [...names, "figure.png", "long.txt"].map(async (name) => ({
      name,
      relativePath: "uploads/" + name,
      mediaType: attachmentMediaType({ name, type: "" })!,
      size: (await stat(path.join(uploads, name))).size,
    }))
  )
  const prepared = await prepareSavedAttachments(taskDir, refs)
  const { parts, workspaceFiles } = chatAttachmentParts(
    prepared,
    "Read the files"
  )
  const history = await publicModelHistory(
    [{ id: "input", role: "user", metadata: { workspaceFiles }, parts }],
    [],
    "bot"
  )
  const prompt = JSON.stringify(history)
  for (const expected of [
    "Alpha & Beta",
    "Check the scales",
    "First result",
    "Second result",
    "Sheet: Samples",
    "A1=Subject ID",
    "B1=172",
    "CALIBRATION 42",
    "[Excerpt truncated.]",
  ])
    assert.ok(prompt.includes(expected), expected)
  assert.ok(prompt.indexOf("First result") < prompt.indexOf("Second result"))
  assert.doesNotMatch(
    prompt,
    /Removed slide|not included in this message|Could not read/
  )
  const picture = prepared[4].part
  assert.ok(
    picture.type === "file" && picture.url.startsWith("data:image/jpeg;base64,")
  )
  const { width, height } = await sharp(
    Buffer.from(picture.url.split(",")[1], "base64")
  ).metadata()
  assert.equal(width, 1536)
  assert.equal(height, 1024)
  assert.ok(
    Buffer.byteLength(JSON.stringify({ parts, workspaceFiles })) < 480 * 1024
  )
  assert.equal(
    (await readFile(path.join(uploads, "long.txt"), "utf8")).length,
    20_000
  )

  for (const relativePath of [
    "uploads/../notes.docx",
    "other/doc.docx",
    "uploads/sub/a.docx",
  ])
    assert.equal(
      storedAttachmentSchema.safeParse({ ...refs[0], relativePath }).success,
      false
    )
  const outside = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "sf-other-attachments-")
  )
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(path.join(outside, "secret.txt"), "hidden from this task")
  await symlink(
    outside,
    path.join(taskDir, "links"),
    process.platform === "win32" ? "junction" : "dir"
  )
  const other = await prepareSavedAttachments(taskDir, [
    { ...refs[0], relativePath: "links/secret.txt" },
    { ...refs[0], relativePath: "uploads/gone.docx" },
  ])
  assert.ok(
    other.every(
      (item) =>
        item.part.type === "text" && item.part.text.includes("Could not read")
    )
  )
  assert.doesNotMatch(JSON.stringify(other), /hidden from this task/)
})
