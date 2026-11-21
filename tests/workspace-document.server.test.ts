import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  readTextInWorkspace,
  saveTextInWorkspace,
} from "../lib/workspace-text.server"
import { workspaceOpenPolicy } from "../lib/workspace-open-policy"
import { MAX_DOCUMENT_BYTES } from "../lib/workspace-document"
import { formatDatasetJson } from "../lib/workspace-json-preview"
import {
  replaceExistingWindowsFile,
  isLocalDesktopRequest,
} from "../lib/workspace-desktop.server"

async function fixture(t: TestContext) {
  const base = await fs.realpath(os.tmpdir())
  const root = await fs.mkdtemp(path.join(base, "scientist-flow-document-"))
  t.after(async () => {
    t.mock.restoreAll()
    assert.equal(path.dirname(root), base)
    assert.ok(path.basename(root).startsWith("scientist-flow-document-"))
    await fs.rm(root, { recursive: true, force: true })
  })
  return root
}
test("central policy blocks dataset regions before otherwise supported extensions", () => {
  for (const name of [
    "data/note.md",
    "DATA/photo.PNG",
    "outputs/checkpoints/readme.txt",
    "outputs\\checkpoints\\x.pdf",
    "x.nii.gz",
    "x.pth",
    "x.csv",
    "x.parquet",
    "x.safetensors",
    "../x.md",
    "C:\\x.md",
    "//host/share/x.txt",
  ])
    assert.equal(workspaceOpenPolicy(name).kind, "blocked", name)
  for (const name of [
    "notes.md",
    "研究 笔记.txt",
    "x.html",
    "x.py",
    "x.tex",
    "x.tsx",
    "x.toml",
    "x.bib",
  ])
    assert.equal(workspaceOpenPolicy(name).kind, "internal-text", name)
  for (const name of [
    "x.pdf",
    "x.doc",
    "x.docx",
    "x.xls",
    "x.xlsx",
    "x.ppt",
    "x.pptx",
  ])
    assert.equal(workspaceOpenPolicy(name).kind, "external", name)
  for (const name of [
    "uploads/截图.PNG",
    "x.JpEg",
    "x.jpg",
    "x.webp",
    "x.avif",
    "x.gif",
    "x.tiff",
    "x.tif",
    "x.ico",
    "x.bmp",
  ])
    assert.equal(workspaceOpenPolicy(name).kind, "internal-image", name)
  for (const name of ["x.exe", "x.lnk", "x.url", "x.bin", "x.docm", "x.svg"])
    assert.equal(workspaceOpenPolicy(name).kind, "unsupported", name)
})
test("dataset JSON previews preserve numeric literals and disk bytes, even at a UTF-8 prefix boundary", async (t) => {
  const root = await fixture(t)
  const relative = "data/scan/subset.JSON"
  await fs.mkdir(path.join(root, "data/scan"), { recursive: true })
  const file = path.join(root, relative)
  const source = '{"id":9007199254740993,"id":2.30e-7,"name":"含有\\\"逗号,括号[]"}'
  await fs.writeFile(file, source)
  const doc = await readTextInWorkspace(root, relative)
  assert.equal(doc.content, source)
  assert.equal(doc.truncated, false)
  assert.equal(formatDatasetJson(doc.content), '{\n  "id": 9007199254740993,\n  "id": 2.30e-7,\n  "name": "含有\\\"逗号,括号[]"\n}')
  assert.equal(workspaceOpenPolicy("outputs/checkpoints/subset.json").kind, "blocked")
  assert.equal(workspaceOpenPolicy("docs/subset.json").kind, "internal-text")
  await assert.rejects(saveTextInWorkspace(root, relative, "{}", doc.version), { code: "UNSUPPORTED" })
  assert.equal(await fs.readFile(file, "utf8"), source)
  const prefix = '"' + 'a'.repeat(MAX_DOCUMENT_BYTES - 2)
  await fs.writeFile(file, prefix + '据"')
  const large = await readTextInWorkspace(root, relative)
  assert.equal(large.truncated, true)
  assert.equal(large.content, prefix)
})

test("Chinese, empty text, BOM and CRLF survive read-save-reopen", async (t) => {
  const root = await fixture(t)
  const file = path.join(root, "研究 笔记.md")
  await fs.writeFile(file, Buffer.from("\ufeff你好\r\n研究\r\n"))
  const original = await readTextInWorkspace(root, "研究 笔记.md")
  assert.equal(original.content, "你好\n研究\n")
  assert.equal(original.bom, true)
  assert.equal(original.newline, "CRLF")
  const saved = await saveTextInWorkspace(
    root,
    "研究 笔记.md",
    "你好\n更新\n第三行\n",
    original.version
  )
  assert.equal(
    await fs.readFile(file, "utf8"),
    "\ufeff你好\r\n更新\r\n第三行\r\n"
  )
  assert.deepEqual(await readTextInWorkspace(root, "研究 笔记.md"), saved)
  await fs.writeFile(path.join(root, "empty.txt"), "")
  const empty = await readTextInWorkspace(root, "empty.txt")
  assert.equal(empty.content, "")
  await saveTextInWorkspace(root, "empty.txt", "", empty.version)
})
test("mixed line endings remain intact on an unchanged-line save", async (t) => {
  const root = await fixture(t)
  await fs.writeFile(path.join(root, "mixed.txt"), "one\r\ntwo\nthree\r")
  const doc = await readTextInWorkspace(root, "mixed.txt")
  assert.equal(doc.newline, "mixed")
  await saveTextInWorkspace(
    root,
    "mixed.txt",
    doc.content.replace("two", "二"),
    doc.version
  )
  assert.equal(
    await fs.readFile(path.join(root, "mixed.txt"), "utf8"),
    "one\r\n二\nthree\r"
  )
})
test("external changes conflict without overwriting the disk", async (t) => {
  const root = await fixture(t),
    file = path.join(root, "note.txt")
  await fs.writeFile(file, "base")
  const doc = await readTextInWorkspace(root, "note.txt")
  await fs.writeFile(file, "external")
  await assert.rejects(
    saveTextInWorkspace(root, "note.txt", "draft", doc.version),
    { code: "CONFLICT" }
  )
  assert.equal(await fs.readFile(file, "utf8"), "external")
  assert.deepEqual(await fs.readdir(root), ["note.txt"])
})
test("missing files are never recreated by saving", async (t) => {
  const root = await fixture(t),
    file = path.join(root, "note.txt")
  await fs.writeFile(file, "base")
  const doc = await readTextInWorkspace(root, "note.txt")
  await fs.unlink(file)
  await assert.rejects(
    saveTextInWorkspace(root, "note.txt", "draft", doc.version),
    { code: "ENOENT" }
  )
  await assert.rejects(fs.stat(file), { code: "ENOENT" })
})
test(
  "Windows atomic replacement also refuses a destination deleted at commit",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await fixture(t)
    const source = path.join(root, "staged.tmp"),
      absent = path.join(root, "gone.txt")
    await fs.writeFile(source, "draft")
    await assert.rejects(
      replaceExistingWindowsFile(source, absent, "a".repeat(64)),
      { code: "NOT_FOUND" }
    )
    await assert.rejects(fs.stat(absent), { code: "ENOENT" })
    assert.equal(await fs.readFile(source, "utf8"), "draft")
  }
)
test("failed staging never truncates the original", async (t) => {
  const root = await fixture(t),
    file = path.join(root, "note.txt")
  await fs.writeFile(file, "base")
  const doc = await readTextInWorkspace(root, "note.txt")
  const open = fs.open
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (args[1] === "wx")
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
    return open(...args)
  })
  await assert.rejects(
    saveTextInWorkspace(root, "note.txt", "draft", doc.version),
    { code: "ENOSPC" }
  )
  assert.equal(await fs.readFile(file, "utf8"), "base")
})
test("bounded reads reject malformed UTF-8, binary and oversized files", async (t) => {
  const root = await fixture(t)
  for (const [name, bytes, code] of [
    ["bad.txt", Buffer.from([0xc3, 0x28]), "ENCODING"],
    ["binary.txt", Buffer.from("hello\0world"), "BINARY"],
    ["large.txt", Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 97), "TOO_LARGE"],
  ] as const) {
    await fs.writeFile(path.join(root, name), bytes)
    await assert.rejects(readTextInWorkspace(root, name), { code })
  }
  await fs.writeFile(
    path.join(root, "limit.txt"),
    Buffer.alloc(MAX_DOCUMENT_BYTES, 97)
  )
  assert.equal(
    (await readTextInWorkspace(root, "limit.txt")).content.length,
    MAX_DOCUMENT_BYTES
  )
})
test("blocked paths cause no file access, including attempts to save", async (t) => {
  const root = await fixture(t)
  t.mock.method(fs, "lstat", () => {
    throw new Error("unexpected file access")
  })
  await assert.rejects(readTextInWorkspace(root, "data/secret.md"), {
    code: "UNSUPPORTED",
  })
  await assert.rejects(
    saveTextInWorkspace(root, "data/secret.md", "draft", "a".repeat(64)),
    { code: "UNSUPPORTED" }
  )
})
test("traversal, absolute paths, directories and intermediate junctions are refused", async (t) => {
  const root = await fixture(t)
  const task = path.join(root, "task"),
    outside = path.join(root, "outside")
  await fs.mkdir(task)
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, "x.md"), "private")
  await fs.mkdir(path.join(task, "directory.md"))
  for (const relative of [
    "../outside/x.md",
    "..\\outside\\x.md",
    path.join(outside, "x.md"),
    "C:outside.md",
    "\\\\host\\share\\x.md",
    ".",
    "",
  ])
    await assert.rejects(readTextInWorkspace(task, relative))
  await assert.rejects(readTextInWorkspace(task, "directory.md"), {
    code: "NOT_FILE",
  })
  await fs.symlink(
    outside,
    path.join(task, "linked"),
    process.platform === "win32" ? "junction" : "dir"
  )
  await assert.rejects(readTextInWorkspace(task, "linked/x.md"), {
    code: "LINK",
  })
  await fs.symlink(
    outside,
    path.join(task, "linked.md"),
    process.platform === "win32" ? "junction" : "dir"
  )
  await assert.rejects(readTextInWorkspace(task, "linked.md"), { code: "LINK" })
  await assert.rejects(
    saveTextInWorkspace(task, "linked/x.md", "draft", "a".repeat(64)),
    { code: "LINK" }
  )
  assert.equal(await fs.readFile(path.join(outside, "x.md"), "utf8"), "private")
})
test("same filenames in separate task roots do not share versions or writes", async (t) => {
  const root = await fixture(t)
  for (const name of ["a", "b"]) {
    await fs.mkdir(path.join(root, name))
    await fs.writeFile(path.join(root, name, "note.txt"), name)
  }
  const a = await readTextInWorkspace(path.join(root, "a"), "note.txt")
  await assert.rejects(
    saveTextInWorkspace(path.join(root, "b"), "note.txt", "wrong", a.version),
    { code: "CONFLICT" }
  )
  await saveTextInWorkspace(
    path.join(root, "a"),
    "note.txt",
    "correct",
    a.version
  )
  assert.equal(await fs.readFile(path.join(root, "b", "note.txt"), "utf8"), "b")
})
test("external adapter is disabled unless explicitly local, and rejects proxies/remote hosts", (t) => {
  const previous = process.env.WORKSPACE_DESKTOP_OPEN
  t.after(() => {
    if (previous === undefined) delete process.env.WORKSPACE_DESKTOP_OPEN
    else process.env.WORKSPACE_DESKTOP_OPEN = previous
  })
  delete process.env.WORKSPACE_DESKTOP_OPEN
  const local = new Headers({
    origin: "http://localhost:3000",
    host: "localhost:3000",
  })
  assert.equal(isLocalDesktopRequest(local), false)
  process.env.WORKSPACE_DESKTOP_OPEN = "1"
  const nextLocal = new Headers(local)
  nextLocal.set("x-forwarded-for", "::ffff:127.0.0.1")
  nextLocal.set("x-forwarded-host", "localhost:3000")
  assert.equal(
    isLocalDesktopRequest(nextLocal),
    process.platform === "win32" && !process.env.CI && !process.env.VERCEL
  )
  for (const [key, value] of [
    ["x-forwarded-for", "127.0.0.1, 127.0.0.1"],
    ["x-forwarded-host", "example.org"],
    ["forwarded", "for=127.0.0.1"],
  ]) {
    const proxy = new Headers(nextLocal)
    proxy.set(key, value)
    assert.equal(isLocalDesktopRequest(proxy), false)
  }
  assert.equal(
    isLocalDesktopRequest(
      new Headers({ origin: "https://server.example", host: "server.example" })
    ),
    false
  )
  assert.equal(
    isLocalDesktopRequest(
      new Headers({
        origin: "http://localhost:3000",
        host: "localhost:3000",
        "x-forwarded-for": "192.168.1.2",
      })
    ),
    false
  )
})
