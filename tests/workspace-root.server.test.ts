import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test, type TestContext } from "node:test"
import {
  assertEmptyWorkspaceRoot,
  isWorkspaceRootEmpty,
} from "../lib/workspace-root.server"
import {
  WORKSPACE_ROOT_NOT_EMPTY,
  workspaceRootFormSchema,
} from "../lib/workspace-validation"

async function fixture(t: TestContext) {
  const parent = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(parent, "scientist-flow-root-"))
  t.after(async () => {
    assert.equal(path.dirname(directory).toLowerCase(), parent.toLowerCase())
    assert.ok(path.basename(directory).startsWith("scientist-flow-root-"))
    await fs.rm(directory, { recursive: true, force: true })
  })
  return directory
}

test("root requires a nonblank path in the shared form schema", () => {
  for (const rootDir of ["", "  ", null, undefined, 1]) {
    assert.equal(workspaceRootFormSchema.safeParse({ rootDir }).success, false)
  }
  assert.equal(
    workspaceRootFormSchema.parse({ rootDir: "  F:\\研究目录  " }).rootDir,
    "F:\\研究目录"
  )
})

test("an existing empty directory can be selected as a root", async (t) => {
  const directory = await fixture(t)
  assert.equal(await isWorkspaceRootEmpty(directory), true)
  await assert.doesNotReject(assertEmptyWorkspaceRoot(directory))
})

for (const entry of ["file", "hidden file", "empty subdirectory"] as const) {
  test(`a root containing an ${entry} is rejected without changing its contents`, async (t) => {
    const directory = await fixture(t)
    const child = path.join(
      directory,
      entry === "hidden file" ? ".keep" : entry
    )
    if (entry === "empty subdirectory") await fs.mkdir(child)
    else await fs.writeFile(child, "isolated test content")
    assert.equal(await isWorkspaceRootEmpty(directory), false)
    await assert.rejects(assertEmptyWorkspaceRoot(directory), {
      message: WORKSPACE_ROOT_NOT_EMPTY,
    })
    if (entry === "empty subdirectory")
      assert.deepEqual(await fs.readdir(child), [])
    else assert.equal(await fs.readFile(child, "utf8"), "isolated test content")
  })
}

test("the submission guard rereads a directory that became nonempty", async (t) => {
  const directory = await fixture(t)
  assert.equal(await isWorkspaceRootEmpty(directory), true)
  await fs.writeFile(path.join(directory, "new.txt"), "created after checking")
  await assert.rejects(assertEmptyWorkspaceRoot(directory), {
    message: WORKSPACE_ROOT_NOT_EMPTY,
  })
})

test("missing directories and regular files are not valid empty roots", async (t) => {
  const directory = await fixture(t)
  const file = path.join(directory, "file.txt")
  await fs.writeFile(file, "test")
  await assert.rejects(assertEmptyWorkspaceRoot(file))
  await assert.rejects(
    assertEmptyWorkspaceRoot(path.join(directory, "missing"))
  )
})
