import assert from "node:assert/strict"
import { test } from "node:test"
import {
  clampWorkspaceWidth,
  shouldCollapseNavigation,
  workspaceLayoutBounds,
} from "../lib/workspace-layout"

test("the workspace cap uses the entire page, not the space after navigation", () => {
  assert.equal(workspaceLayoutBounds(1440, 1230).max, 909)
  assert.equal(workspaceLayoutBounds(1440, 1392).max, 960)
  assert.equal(workspaceLayoutBounds(1920, 1710).max, 1280)
})

test("navigation collapses before the chat reaches its hard minimum", () => {
  assert.equal(shouldCollapseNavigation(1230, 800), false)
  assert.equal(shouldCollapseNavigation(1230, 845), true)
  assert.equal(shouldCollapseNavigation(1392, 845), false)
})

test("smaller desktops protect chat width and fit an explicitly reopened navigation", () => {
  assert.deepEqual(workspaceLayoutBounds(768, 558), {
    chatMin: 277,
    min: 280,
    max: 280,
  })
  assert.equal(workspaceLayoutBounds(768, 720).max, 399)
  assert.equal(clampWorkspaceWidth(960, 1024, 976), 655)
  assert.equal(clampWorkspaceWidth(100, 1024, 976), 280)
})

test("bounds tolerate zero-size containers before measurement", () => {
  assert.equal(clampWorkspaceWidth(400, 0, 0), 0)
})

test("every supported desktop width fits both panels within the 2/3 cap", () => {
  for (let page = 768; page <= 3840; page += 1) {
    for (const sidebar of [48, 210]) {
      const content = page - sidebar
      const bounds = workspaceLayoutBounds(page, content)
      const width = clampWorkspaceWidth(2000, page, content)
      assert.ok(width <= Math.floor((page * 2) / 3))
      assert.ok(width + bounds.chatMin + 1 <= content)
      assert.ok(bounds.min <= bounds.max)
      assert.ok(width >= 280)
    }
  }
})
