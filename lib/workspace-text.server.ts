import "server-only"
import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { readWorkspaceFileBytes } from "./workspace-file.server"
import {
  resolveWorkspaceDirectory,
  WorkspaceDirectoryError,
} from "./workspace-directory.server"
import { workspaceOpenPolicy } from "./workspace-open-policy"
import {
  MAX_DOCUMENT_BYTES,
  saveDocumentSchema,
  type TextDocument,
} from "./workspace-document"
import { replaceExistingWindowsFile } from "./workspace-desktop.server"

const fail = (code: string, message: string): never => {
  throw new WorkspaceDirectoryError(code, message)
}
function assertText(relative: string) {
  const policy = workspaceOpenPolicy(relative)
  if (policy.kind !== "internal-text")
    fail("UNSUPPORTED", "This file cannot be opened as text.")
}
function assertCharacters(text: string) {
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (
      (code < 32 && ![9, 10, 13].includes(code)) ||
      code === 127 ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      fail("BINARY", "This file is not supported UTF-8 text.")
  }
}
function decode(
  bytes: Buffer,
  truncated = false
): Omit<TextDocument, "version"> {
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bom ? bytes.subarray(3) : bytes,
      { stream: truncated }
    )
  } catch {
    return fail("ENCODING", "Only valid UTF-8 text is supported.")
  }
  assertCharacters(content)
  const endings = new Set(content.match(/\r\n|\r|\n/g) ?? [])
  const newline =
    endings.size > 1
      ? "mixed"
      : endings.has("\r\n")
        ? "CRLF"
        : endings.has("\r")
          ? "CR"
          : "LF"
  return { content: content.replace(/\r\n|\r/g, "\n"), bom, newline }
}

async function readSnapshot(taskDir: string, relative: string) {
  assertText(relative)
  const { target, raw } = await readWorkspaceFileBytes(
    taskDir,
    relative,
    MAX_DOCUMENT_BYTES,
    "Text files are limited to 256 KiB."
  )
  const version = createHash("sha256")
    .update(target.identity)
    .update(raw)
    .digest("hex")
  return { target, raw, document: { ...decode(raw), version } }
}

export async function readTextInWorkspace(
  taskDir: string,
  relative: string
): Promise<TextDocument> {
  if (workspaceOpenPolicy(relative).kind === "data-json-preview") {
    const { target, raw } = await readWorkspaceFileBytes(
      taskDir,
      relative,
      Number.MAX_SAFE_INTEGER,
      "Dataset file is too large.",
      MAX_DOCUMENT_BYTES
    )
    const truncated = target.stat.size > BigInt(raw.length)
    return {
      ...decode(raw, truncated),
      version: createHash("sha256")
        .update(target.identity)
        .update(raw)
        .digest("hex"),
      truncated,
    }
  }
  return (await readSnapshot(taskDir, relative)).document
}

export async function saveTextInWorkspace(
  taskDir: string,
  relative: string,
  content: string,
  baseVersion: string
): Promise<TextDocument> {
  // Shared schema also applies when this filesystem function is called directly.
  saveDocumentSchema.parse({
    chatId: "validation",
    relativePath: relative,
    content,
    baseVersion,
  })
  assertCharacters(content)
  const original = await readSnapshot(taskDir, relative)
  if (original.document.version !== baseVersion)
    fail("CONFLICT", "The file changed on disk. Your draft has been kept.")
  const normalized = content.replace(/\r\n|\r/g, "\n")
  // Preserve mixed endings for existing lines; new lines use the first original ending.
  const endings =
    new TextDecoder().decode(original.raw).match(/\r\n|\r|\n/g) ?? []
  let line = 0
  const encodedText = normalized.replace(
    /\n/g,
    () => endings[line++] ?? endings[0] ?? "\n"
  )
  const bytes = Buffer.concat([
    original.document.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
    Buffer.from(encodedText),
  ])
  if (bytes.length > MAX_DOCUMENT_BYTES)
    fail(
      "TOO_LARGE",
      "Text files are limited to 256 KiB, including line endings and BOM."
    )
  const parentRelative = relative
    .replace(/\\/g, "/")
    .split("/")
    .slice(0, -1)
    .join("/")
  const parent = await resolveWorkspaceDirectory(taskDir, parentRelative)
  const temporary = path.join(
    parent.absolute,
    `.scientist-flow-${randomUUID()}.tmp`
  )
  let written = false
  try {
    const handle = await fs.open(
      temporary,
      "wx",
      Number(original.target.stat.mode & BigInt(0o777))
    )
    written = true
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    const current = await readSnapshot(taskDir, relative)
    if (current.document.version !== baseVersion)
      fail("CONFLICT", "The file changed on disk. Your draft has been kept.")
    if (process.platform === "win32") {
      // File.Replace requires an EXISTING destination, unlike rename. No delete/create fallback.
      await replaceExistingWindowsFile(
        temporary,
        current.target.absolute,
        createHash("sha256").update(current.raw).digest("hex")
      )
    } else {
      await fs.rename(temporary, current.target.absolute)
    }
    written = false
    const saved = await readSnapshot(taskDir, relative)
    if (!saved.raw.equals(bytes))
      fail(
        "CONFLICT",
        "The file changed again after saving. Your draft has been kept."
      )
    return saved.document
  } finally {
    if (written) {
      // Never follow a swapped parent to clean up a temporary file.
      const checked = await resolveWorkspaceDirectory(
        taskDir,
        parentRelative
      ).catch(() => null)
      if (checked?.identity === parent.identity)
        await fs.unlink(temporary).catch(() => undefined)
    }
  }
}
