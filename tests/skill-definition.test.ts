import assert from "node:assert/strict"
import test from "node:test"
import { parse } from "yaml"
import { skillFormSchema } from "../db/schema"
import { serializeSkillToMarkdown, skillPath } from "../lib/skill-definition"

const definition = {
  name: "literature-review",
  description: '科研综述: "方法" #比较\n---\n何时使用：整理证据',
  instructions: "    indented code\n\n# 步骤\n\n```txt\n  keep spaces  \n```\n",
}

test("a SKILL.md round trip preserves the two discovery fields and the entire Markdown body", () => {
  for (const name of [definition.name, "false", "123"]) {
    for (const description of [
      definition.description,
      "true",
      "001",
      "# notes",
      '引号 " 与 \\ 路径',
    ]) {
      const input = {
        ...definition,
        name,
        description,
        displayName: "文献综述",
        id: "private",
      }
      const file = serializeSkillToMarkdown(input)
      const parts = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(file)
      assert.ok(parts)
      assert.deepEqual(parse(parts[1]), { name, description })
      assert.equal(parts[2], definition.instructions)
      assert.equal(skillPath(name), `/skills/${name}/SKILL.md`)
    }
  }
})

test("the same identifier rules protect writes and virtual paths", () => {
  for (const name of [
    "",
    " ",
    "a--b",
    "-a",
    "a-",
    "../x",
    "a/b",
    "a\\b",
    "A",
    "a b",
    "a\n",
    "文献",
    "a".repeat(65),
  ]) {
    assert.equal(
      skillFormSchema.safeParse({ ...definition, name }).success,
      false
    )
    assert.throws(() => skillPath(name))
    assert.throws(() => serializeSkillToMarkdown({ ...definition, name }))
  }
  assert.ok(
    skillFormSchema.safeParse({ ...definition, name: "a".repeat(64) }).success
  )
})

test("only editable fields are accepted; optional titles and descriptions normalize without rewriting instructions", () => {
  for (const field of ["id", "createdAt", "updatedAt", "enabled"]) {
    assert.equal(
      skillFormSchema.safeParse({ ...definition, [field]: "extra" }).success,
      false
    )
  }
  for (const displayName of [undefined, null, "  "]) {
    const values = skillFormSchema.parse({
      ...definition,
      displayName,
      description: "  用途  ",
    })
    assert.equal(values.displayName, null)
    assert.equal(values.description, "用途")
    assert.equal(values.instructions, definition.instructions)
  }
  assert.equal(
    skillFormSchema.parse({ ...definition, displayName: " 中文 " }).displayName,
    "中文"
  )
  for (const description of ["  ", "a".repeat(1025)]) {
    assert.equal(
      skillFormSchema.safeParse({ ...definition, description }).success,
      false
    )
  }
  for (const instructions of [" \n\t", "---\nname: nested\n---\n\nBody"]) {
    assert.equal(
      skillFormSchema.safeParse({ ...definition, instructions }).success,
      false
    )
  }
  assert.ok(
    skillFormSchema.safeParse({
      ...definition,
      instructions: "---\n\nA paragraph\n\n---\n",
    }).success
  )
})
