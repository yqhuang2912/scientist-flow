import assert from "node:assert/strict"
import test from "node:test"
import { versionTreeRows } from "../lib/workflow-version-tree"

test("branches converge on the selected parent, including when it is several versions older", () => {
  const history = [
    [5, 3],
    [4, 2],
    [3, 1],
    [2, 1],
    [1, null],
  ] as const
  const rows = versionTreeRows(
    history.map(([version, parentVersion]) => ({
      version,
      parentVersion,
      publishedAt: "",
    }))
  )
  assert.deepEqual(
    rows.map((r) => [r.lane, r.parentLane, r.incoming]),
    [
      [0, 0, []],
      [1, 1, [0]],
      [0, 0, [0, 1]],
      [1, 0, [0, 1]],
      [0, null, [0]],
    ]
  )
})

test("a linear release history stays in a single lane", () => {
  assert.deepEqual(versionTreeRows([]), [])
  const rows = versionTreeRows(
    [3, 2, 1].map((version) => ({
      version,
      parentVersion: version > 1 ? version - 1 : null,
      publishedAt: "",
    }))
  )
  assert.deepEqual(
    rows.map((r) => [r.lane, r.parentLane]),
    [
      [0, 0],
      [0, 0],
      [0, null],
    ]
  )
})
