import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  createDirectoryInWorkspace,
  deleteDirectoryInWorkspace,
  inspectDirectoryInWorkspace,
  resolveWorkspaceDirectory,
} from "../lib/workspace-directory.server"
import {
  workspaceDirectoryNameSchema,
  workspaceRelativePathSchema,
  deleteWorkspaceDirectorySchema,
} from "../lib/workspace-validation"

async function fixture(t: TestContext) {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "scientist-flow-folders-"))
  )
  const root = path.join(temp, "task")
  const outside = path.join(temp, "outside")
  await fs.mkdir(root)
  await fs.mkdir(outside)
  t.after(async () => {
    t.mock.restoreAll()
    // Only the unique directory created by this test may be removed.
    assert.equal(
      path.dirname(temp).toLowerCase(),
      (await fs.realpath(os.tmpdir())).toLowerCase()
    )
    assert.ok(path.basename(temp).startsWith("scientist-flow-folders-"))
    await fs.rm(temp, { recursive: true, force: true })
  })
  return { root, outside }
}

for (const name of [
  "中文实验",
  "RNA seq 2026",
  "研究 (第一阶段)",
  "a.b-c_d",
  " leading space",
  "α β",
  "COM10",
]) {
  test(`name preserves: ${name}`, () =>
    assert.equal(workspaceDirectoryNameSchema.parse(name), name))
}
for (const name of [
  "",
  "   ",
  ".",
  "..",
  "a/b",
  "a\\b",
  "/absolute",
  "C:\\task",
  "\\\\server\\share",
  "x:y",
  "a<b",
  "a>b",
  'a"b',
  "a|b",
  "a?b",
  "a*b",
  "a\u0000b",
  "a\nb",
  "a\u007fb",
  "CON",
  "nul.txt",
  "AUX.csv",
  "prn",
  "COM1.log",
  "LPT9",
  "COM¹",
  "LPT².txt",
  "CONOUT$",
  "x ",
  "x.",
  "x".repeat(256),
]) {
  test(`reject invalid name: ${JSON.stringify(name)}`, () =>
    assert.equal(workspaceDirectoryNameSchema.safeParse(name).success, false))
}
for (const relative of [
  "../a",
  "..\\a",
  "docs/../a",
  "docs\\..\\a",
  "/docs",
  "\\docs",
  "C:docs",
  "C:\\docs",
  "\\\\server\\share",
  "//server/share",
  ".",
  "docs//child",
  "docs/.",
  "docs/",
  "docs/CON",
  "docs ",
]) {
  test(`reject path injection: ${relative}`, () =>
    assert.equal(
      workspaceRelativePathSchema.safeParse(relative).success,
      false
    ))
}

test("normalises only separators, not names", () => {
  assert.equal(workspaceRelativePathSchema.parse("docs\\研究 1"), "docs/研究 1")
  assert.equal(workspaceRelativePathSchema.parse(""), "")
})

test("create one child; conflict with files/directories; no missing-parent creation", async (t) => {
  const { root } = await fixture(t)
  const created = await createDirectoryInWorkspace(root, "", "中文 空格")
  assert.equal(created.relPath, "中文 空格")
  await createDirectoryInWorkspace(root, created.relPath, "child")
  await assert.rejects(createDirectoryInWorkspace(root, "", "中文 空格"), {
    code: "EEXIST",
  })
  await fs.writeFile(path.join(root, "file"), "keep")
  await assert.rejects(createDirectoryInWorkspace(root, "", "file"), {
    code: "EEXIST",
  })
  await assert.rejects(
    createDirectoryInWorkspace(root, "missing/deep", "child"),
    { code: "ENOENT" }
  )
  await assert.rejects(fs.stat(path.join(root, "missing")), { code: "ENOENT" })
  const raced = await Promise.allSettled([
    createDirectoryInWorkspace(root, "", "same"),
    createDirectoryInWorkspace(root, "", "same"),
  ])
  assert.equal(
    raced.filter((result) => result.status === "fulfilled").length,
    1
  )
})

test("inspection is read only; empty deletion; missing target is explicit", async (t) => {
  const { root } = await fixture(t)
  await createDirectoryInWorkspace(root, "", "empty")
  const inspected = await inspectDirectoryInWorkspace(root, "empty")
  assert.equal(inspected.isEmpty, true)
  assert.equal((await fs.stat(path.join(root, "empty"))).isDirectory(), true)
  await deleteDirectoryInWorkspace(root, "empty", {
    mode: "empty",
    identity: inspected.identity,
  })
  await assert.rejects(inspectDirectoryInWorkspace(root, "empty"), {
    code: "ENOENT",
  })
})

test("empty confirmation never upgrades when content appears", async (t) => {
  const { root } = await fixture(t)
  await createDirectoryInWorkspace(root, "", "changed")
  const inspected = await inspectDirectoryInWorkspace(root, "changed")
  await fs.writeFile(path.join(root, "changed", "research.txt"), "keep")
  await assert.rejects(
    deleteDirectoryInWorkspace(root, "changed", {
      mode: "empty",
      identity: inspected.identity,
    }),
    { code: "CHANGED" }
  )
  assert.equal(
    await fs.readFile(path.join(root, "changed", "research.txt"), "utf8"),
    "keep"
  )
})

test("rmdir catches a write occurring after the final empty inspection", async (t) => {
  const { root } = await fixture(t)
  await createDirectoryInWorkspace(root, "", "race")
  const inspected = await inspectDirectoryInWorkspace(root, "race")
  const rmdir = fs.rmdir.bind(fs)
  t.mock.method(fs, "rmdir", async (target: string) => {
    await fs.writeFile(path.join(target, "late.txt"), "keep")
    return rmdir(target)
  })
  await assert.rejects(
    deleteDirectoryInWorkspace(root, "race", {
      mode: "empty",
      identity: inspected.identity,
    }),
    { code: "CHANGED" }
  )
  assert.equal(
    await fs.readFile(path.join(root, "race", "late.txt"), "utf8"),
    "keep"
  )
})

test("recursive deletion requires explicit mode, identity and exact name", async (t) => {
  const { root } = await fixture(t)
  await fs.mkdir(path.join(root, "parent", "child"), { recursive: true })
  await fs.writeFile(path.join(root, "parent", "child", "file"), "test-only")
  const inspected = await inspectDirectoryInWorkspace(root, "parent")
  assert.equal(inspected.isEmpty, false)
  assert.equal(
    deleteWorkspaceDirectorySchema.safeParse({ recursive: true }).success,
    false
  )
  await assert.rejects(
    deleteDirectoryInWorkspace(root, "parent", {
      mode: "recursive",
      identity: inspected.identity,
      name: "PARENT",
    }),
    { code: "CONFIRMATION" }
  )
  await assert.rejects(
    deleteDirectoryInWorkspace(root, "parent", {
      mode: "empty",
      identity: inspected.identity,
    }),
    { code: "CHANGED" }
  )
  await assert.rejects(
    deleteDirectoryInWorkspace(root, "parent", {
      mode: "recursive",
      identity: "0".repeat(64),
      name: "parent",
    }),
    { code: "CHANGED" }
  )
  await deleteDirectoryInWorkspace(root, "parent", {
    mode: "recursive",
    identity: inspected.identity,
    name: "parent",
  })
  await assert.rejects(fs.stat(path.join(root, "parent")), { code: "ENOENT" })
})

test("root, files and traversal cannot be deletion targets", async (t) => {
  const { root, outside } = await fixture(t)
  await fs.writeFile(path.join(root, "file"), "keep")
  const confirmation = { mode: "empty", identity: "0".repeat(64) }
  for (const relative of [
    "",
    ".",
    "..",
    "../outside",
    "..\\outside",
    outside,
    "C:\\",
    "\\\\server\\share",
    "file",
  ]) {
    await assert.rejects(
      deleteDirectoryInWorkspace(root, relative, confirmation)
    )
    await assert.rejects(inspectDirectoryInWorkspace(root, relative))
  }
  assert.equal(await fs.readFile(path.join(root, "file"), "utf8"), "keep")
  assert.equal((await fs.stat(root)).isDirectory(), true)
})

test("reject root, ancestor, intermediate and target junctions; internal links unlink only", async (t) => {
  const { root, outside } = await fixture(t)
  await fs.mkdir(path.join(outside, "nested"))
  await fs.writeFile(
    path.join(outside, "nested", "keep.txt"),
    "outside-content"
  )
  await fs.symlink(outside, path.join(root, "link"), "junction")
  await assert.rejects(resolveWorkspaceDirectory(root, "link/nested"), {
    code: "LINK",
  })
  await assert.rejects(createDirectoryInWorkspace(root, "link", "no"), {
    code: "LINK",
  })
  await assert.rejects(inspectDirectoryInWorkspace(root, "link"), {
    code: "LINK",
  })
  await assert.rejects(
    deleteDirectoryInWorkspace(root, "link", {
      mode: "empty",
      identity: "0".repeat(64),
    }),
    { code: "LINK" }
  )
  await assert.rejects(resolveWorkspaceDirectory(path.join(root, "link"), ""), {
    code: "LINK",
  })
  await assert.rejects(
    resolveWorkspaceDirectory(path.join(root, "link", "nested"), ""),
    { code: "LINK" }
  )
  await fs.mkdir(path.join(root, "remove"))
  await fs.symlink(
    outside,
    path.join(root, "remove", "outside-link"),
    "junction"
  )
  const inspected = await inspectDirectoryInWorkspace(root, "remove")
  await deleteDirectoryInWorkspace(root, "remove", {
    mode: "recursive",
    identity: inspected.identity,
    name: "remove",
  })
  assert.equal(
    await fs.readFile(path.join(outside, "nested", "keep.txt"), "utf8"),
    "outside-content"
  )
})

test("replacement folder and different task invalidate old confirmation", async (t) => {
  const { root, outside } = await fixture(t)
  await fs.mkdir(path.join(root, "same"))
  const inspected = await inspectDirectoryInWorkspace(root, "same")
  await fs.rename(path.join(root, "same"), path.join(root, "original"))
  await fs.mkdir(path.join(root, "same"))
  await fs.mkdir(path.join(outside, "same"))
  const confirmation = { mode: "empty", identity: inspected.identity }
  await assert.rejects(deleteDirectoryInWorkspace(root, "same", confirmation), {
    code: "CHANGED",
  })
  await assert.rejects(
    deleteDirectoryInWorkspace(outside, "same", confirmation),
    { code: "CHANGED" }
  )
})

test("partial failure reports error; reinspection observes remaining disk contents", async (t) => {
  const { root } = await fixture(t)
  await fs.mkdir(path.join(root, "partial"))
  await fs.writeFile(path.join(root, "partial", "first"), "test")
  await fs.writeFile(path.join(root, "partial", "second"), "test")
  const inspected = await inspectDirectoryInWorkspace(root, "partial")
  const unlink = fs.unlink.bind(fs)
  let calls = 0
  t.mock.method(fs, "unlink", async (target: string) => {
    if (++calls === 2)
      throw Object.assign(new Error("test busy file"), { code: "EBUSY" })
    return unlink(target)
  })
  await assert.rejects(
    deleteDirectoryInWorkspace(root, "partial", {
      mode: "recursive",
      identity: inspected.identity,
      name: "partial",
    }),
    { code: "EBUSY" }
  )
  assert.equal((await fs.readdir(path.join(root, "partial"))).length, 1)
  assert.equal(
    (await inspectDirectoryInWorkspace(root, "partial")).isEmpty,
    false
  )
})

test(
  "Windows casing and separators are accepted inside the same boundary",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { root } = await fixture(t)
    await fs.mkdir(path.join(root, "Docs"))
    await fs.mkdir(path.join(root, "Docs", "Nested"))
    const resolved = await resolveWorkspaceDirectory(
      root.toUpperCase(),
      "docs\\nested"
    )
    assert.equal(
      resolved.absolute.toLowerCase(),
      path.join(root, "Docs", "Nested").toLowerCase()
    )
  }
)
