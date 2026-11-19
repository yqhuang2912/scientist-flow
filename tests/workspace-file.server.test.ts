import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  createFileInWorkspace,
  uploadFileToWorkspace,
  inspectFileInWorkspace,
  deleteFileInWorkspace,
  fileError,
} from "../lib/workspace-file.server"
import {
  workspaceFileNameSchema,
  deleteWorkspaceFileSchema,
} from "../lib/workspace-validation"

async function fixture(t: TestContext) {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "scientist-flow-files-"))
  )
  const root = path.join(temp, "task")
  const outside = path.join(temp, "outside")
  await fs.mkdir(root)
  await fs.mkdir(outside)
  t.after(async () => {
    t.mock.restoreAll()
    assert.equal(
      path.dirname(temp).toLowerCase(),
      (await fs.realpath(os.tmpdir())).toLowerCase()
    )
    assert.ok(path.basename(temp).startsWith("scientist-flow-files-"))
    await fs.rm(temp, { recursive: true, force: true })
  })
  return { root, outside, temp }
}

test("streams every byte and keeps separate copies of same-name chat attachments", async (t) => {
  const { root } = await fixture(t)
  const input = { name: "评审 意见.docx", size: 4 }
  const body = () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(Uint8Array.of(0, 255))
        c.enqueue(Uint8Array.of(12, 34))
        c.close()
      },
    })
  const entry = await uploadFileToWorkspace(root, "", input, body())
  assert.deepEqual(
    await fs.readFile(path.join(root, entry.name)),
    Buffer.from([0, 255, 12, 34])
  )
  await assert.rejects(uploadFileToWorkspace(root, "", input, body()), {
    code: "CONFLICT",
  })
  const copy = await uploadFileToWorkspace(root, "", input, body(), true)
  assert.equal(copy.relPath, "评审 意见 (1).docx")
})

test("invalid lengths, interrupted transfers and linked parents leave no uploaded file", async (t) => {
  const { root, outside } = await fixture(t)
  const upload = (
    size: number,
    stream: ReadableStream<Uint8Array>,
    parent = ""
  ) => uploadFileToWorkspace(root, parent, { name: "文件.pdf", size }, stream)
  const body = () => new Blob(["1234"]).stream()
  await assert.rejects(upload(3, body()), /exceeded/)
  await assert.rejects(upload(5, body()), /incomplete/)
  await assert.rejects(upload(200_000_001, body()), /200 MB/)
  let delivered = false
  await assert.rejects(
    upload(
      4,
      new ReadableStream({
        pull(c) {
          if (delivered) c.error(new Error("disconnected"))
          else {
            delivered = true
            c.enqueue(Uint8Array.of(1))
          }
        },
      })
    ),
    /disconnected/
  )
  assert.deepEqual(await fs.readdir(root), [])
  await fs.symlink(
    outside,
    path.join(root, "outside"),
    process.platform === "win32" ? "junction" : "dir"
  )
  await assert.rejects(upload(4, body(), "outside"), { code: "LINK" })
  assert.deepEqual(await fs.readdir(outside), [])
})

test("file names preserve Chinese, spaces, extensions and extensionless names", () => {
  for (const name of [
    "研究 笔记.md",
    "analysis.py",
    ".gitignore",
    "README",
    " leading space.txt",
  ])
    assert.equal(workspaceFileNameSchema.parse(name), name)
  for (const name of [
    "",
    " ",
    ".",
    "..",
    "a/b.txt",
    "a\\b.txt",
    "C:a.txt",
    "\\\\server\\x",
    "NUL.txt",
    "CON .txt",
    "LPT².csv",
    "a.\n",
    "a.",
    "a ",
    "a\0b",
    "a?b",
  ])
    assert.equal(workspaceFileNameSchema.safeParse(name).success, false, name)
})

test("creates exact empty files at root and an existing nested parent", async (t) => {
  const { root } = await fixture(t)
  await fs.mkdir(path.join(root, "docs", "deep"), { recursive: true })
  const entry = await createFileInWorkspace(root, "", "研究 笔记.md")
  assert.deepEqual(entry, {
    name: "研究 笔记.md",
    isDir: false,
    isFile: true,
    relPath: "研究 笔记.md",
  })
  assert.equal((await fs.stat(path.join(root, entry.relPath))).size, 0)
  const nested = await createFileInWorkspace(root, "docs\\deep", "README")
  assert.equal(nested.relPath, "docs/deep/README")
  assert.equal(await fs.readFile(path.join(root, nested.relPath), "utf8"), "")
  await assert.rejects(createFileInWorkspace(root, "missing/parent", "x.txt"), {
    code: "ENOENT",
  })
  await assert.rejects(fs.stat(path.join(root, "missing")), { code: "ENOENT" })
})

test("file and directory collisions preserve existing data; concurrent creates have one winner", async (t) => {
  const { root } = await fixture(t)
  await fs.writeFile(path.join(root, "keep.txt"), "research data")
  await fs.mkdir(path.join(root, "folder"))
  for (const name of ["keep.txt", "folder"])
    await assert.rejects(
      createFileInWorkspace(root, "", name),
      (error) => fileError(error).code === "CONFLICT"
    )
  assert.equal(
    await fs.readFile(path.join(root, "keep.txt"), "utf8"),
    "research data"
  )
  const results = await Promise.allSettled([
    createFileInWorkspace(root, "", "race.txt"),
    createFileInWorkspace(root, "", "race.txt"),
  ])
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  )
})

test("inspection is read only; deletion requires an explicit confirmation tied to this file", async (t) => {
  const { root } = await fixture(t)
  await fs.writeFile(path.join(root, "keep.txt"), "keep")
  const inspected = await inspectFileInWorkspace(root, "keep.txt")
  assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep")
  for (const confirmation of [
    {},
    { confirmed: false, identity: inspected.identity },
    { confirmed: true },
    { confirmed: true, identity: inspected.identity, recursive: true },
  ]) {
    assert.equal(
      deleteWorkspaceFileSchema.safeParse(confirmation).success,
      false
    )
    await assert.rejects(deleteFileInWorkspace(root, "keep.txt", confirmation))
  }
  await deleteFileInWorkspace(root, "keep.txt", {
    confirmed: true,
    identity: inspected.identity,
  })
  await assert.rejects(fs.stat(path.join(root, "keep.txt")), { code: "ENOENT" })
  await assert.rejects(
    deleteFileInWorkspace(root, "keep.txt", {
      confirmed: true,
      identity: inspected.identity,
    }),
    { code: "ENOENT" }
  )
})

test("modified, replaced, or another task's file needs a fresh confirmation", async (t) => {
  const { root, outside } = await fixture(t)
  await fs.writeFile(path.join(root, "a.txt"), "a")
  await fs.writeFile(path.join(outside, "a.txt"), "a")
  const before = await inspectFileInWorkspace(root, "a.txt")
  const confirmation = { confirmed: true, identity: before.identity }
  await assert.rejects(deleteFileInWorkspace(outside, "a.txt", confirmation), {
    code: "CHANGED",
  })
  await fs.writeFile(path.join(root, "a.txt"), "changed")
  await assert.rejects(deleteFileInWorkspace(root, "a.txt", confirmation), {
    code: "CHANGED",
  })
  const modified = await inspectFileInWorkspace(root, "a.txt")
  await fs.rename(path.join(root, "a.txt"), path.join(root, "old.txt"))
  await fs.writeFile(path.join(root, "a.txt"), "replacement")
  await assert.rejects(
    deleteFileInWorkspace(root, "a.txt", {
      confirmed: true,
      identity: modified.identity,
    }),
    { code: "CHANGED" }
  )
  assert.equal(
    await fs.readFile(path.join(root, "a.txt"), "utf8"),
    "replacement"
  )
})

test("root, directories and injected paths cannot be deleted as files", async (t) => {
  const { root } = await fixture(t)
  await fs.mkdir(path.join(root, "docs"))
  for (const relative of [
    "",
    ".",
    "..",
    "../outside/a",
    "..\\outside\\a",
    "C:\\a",
    "C:a",
    "\\\\server\\share",
    "/tmp/a",
    "docs",
  ])
    await assert.rejects(
      deleteFileInWorkspace(root, relative, {
        confirmed: true,
        identity: "0".repeat(64),
      }),
      relative
    )
  assert.equal((await fs.stat(path.join(root, "docs"))).isDirectory(), true)
})

test("junctions as parent, target or binding are rejected and outside contents survive", async (t) => {
  const { root, outside, temp } = await fixture(t)
  await fs.writeFile(path.join(outside, "keep.txt"), "outside")
  await fs.symlink(outside, path.join(root, "link"), "junction")
  await fs.symlink(root, path.join(temp, "bound-link"), "junction")
  await assert.rejects(createFileInWorkspace(root, "link", "new.txt"), {
    code: "LINK",
  })
  await assert.rejects(inspectFileInWorkspace(root, "link/keep.txt"), {
    code: "LINK",
  })
  await assert.rejects(
    deleteFileInWorkspace(root, "link", {
      confirmed: true,
      identity: "0".repeat(64),
    }),
    { code: "LINK" }
  )
  await assert.rejects(
    createFileInWorkspace(path.join(temp, "bound-link"), "", "new.txt"),
    { code: "LINK" }
  )
  assert.equal(
    await fs.readFile(path.join(outside, "keep.txt"), "utf8"),
    "outside"
  )
  assert.deepEqual(await fs.readdir(outside), ["keep.txt"])
})

test("file symlinks cannot be created over or deleted as regular files", async (t) => {
  const { root, outside } = await fixture(t)
  const external = path.join(outside, "keep.txt")
  await fs.writeFile(external, "outside")
  try {
    await fs.symlink(external, path.join(root, "linked.txt"), "file")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Windows file symlink privilege unavailable")
      return
    }
    throw error
  }
  await assert.rejects(inspectFileInWorkspace(root, "linked.txt"), {
    code: "LINK",
  })
  await assert.rejects(
    deleteFileInWorkspace(root, "linked.txt", {
      confirmed: true,
      identity: "0".repeat(64),
    }),
    { code: "LINK" }
  )
  await assert.rejects(createFileInWorkspace(root, "", "linked.txt"), {
    code: "EEXIST",
  })
  assert.equal(await fs.readFile(external, "utf8"), "outside")
})

test(
  "Windows file lookup accepts casing while creation never overrides it",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { root } = await fixture(t)
    await createFileInWorkspace(root, "", "Notes.md")
    await assert.rejects(createFileInWorkspace(root, "", "notes.MD"), {
      code: "EEXIST",
    })
    const inspected = await inspectFileInWorkspace(
      root.toUpperCase(),
      "notes.MD"
    )
    await deleteFileInWorkspace(root, "Notes.md", {
      confirmed: true,
      identity: inspected.identity,
    })
    assert.deepEqual(await fs.readdir(root), [])
  }
)

test("unlink failure retains the file and permits a fresh retry", async (t) => {
  const { root } = await fixture(t)
  await createFileInWorkspace(root, "", "locked.txt")
  const before = await inspectFileInWorkspace(root, "locked.txt")
  const unlink = t.mock.method(fs, "unlink", async () => {
    throw Object.assign(new Error("busy"), { code: "EBUSY" })
  })
  await assert.rejects(
    deleteFileInWorkspace(root, "locked.txt", {
      confirmed: true,
      identity: before.identity,
    }),
    { code: "EBUSY" }
  )
  assert.equal((await fs.stat(path.join(root, "locked.txt"))).isFile(), true)
  unlink.mock.restore()
  const fresh = await inspectFileInWorkspace(root, "locked.txt")
  await deleteFileInWorkspace(root, "locked.txt", {
    confirmed: true,
    identity: fresh.identity,
  })
})
