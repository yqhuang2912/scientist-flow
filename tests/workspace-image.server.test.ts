import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { test } from "node:test"
import sharp from "sharp"
import {
  readWorkspaceImage,
  MAX_IMAGE_BYTES,
} from "../lib/workspace-image.server"

test("workspace images use verified bytes and a bounded first-page TIFF preview", async (t) => {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "sf-image-")
  )
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const image = () =>
    sharp({
      create: { width: 8, height: 6, channels: 3, background: "#74869a" },
    })
  const bytes = await image().png().toBuffer()
  await fs.writeFile(path.join(root, "中文 file.PNG"), bytes)
  const png = await readWorkspaceImage(root, "中文 file.PNG")
  assert.equal(png.type, "image/png")
  assert.deepEqual(png.bytes, bytes)
  await image().jpeg().toFile(path.join(root, "mislabeled.png"))
  assert.equal(
    (await readWorkspaceImage(root, "mislabeled.png")).type,
    "image/jpeg"
  )
  await image().tiff().toFile(path.join(root, "scan.tif"))
  const tiff = await readWorkspaceImage(root, "scan.tif")
  assert.equal(tiff.type, "image/png")
  assert.equal((await sharp(tiff.bytes).metadata()).width, 8)
  await fs.writeFile(path.join(root, "fake.png"), "<svg/>")
  await assert.rejects(readWorkspaceImage(root, "fake.png"), {
    code: "INVALID_IMAGE",
  })
  await fs.writeFile(path.join(root, "large.png"), "")
  await fs.truncate(path.join(root, "large.png"), MAX_IMAGE_BYTES + 1)
  await assert.rejects(readWorkspaceImage(root, "large.png"), {
    code: "TOO_LARGE",
  })
  for (const name of [
    "data/photo.png",
    "outputs/checkpoints/chart.webp",
    "../outside.png",
    "paper.docx",
    "drawing.svg",
  ])
    await assert.rejects(readWorkspaceImage(root, name), {
      code: "UNSUPPORTED",
    })
  await fs.mkdir(path.join(root, "real"))
  await fs.symlink(
    path.join(root, "real"),
    path.join(root, "linked"),
    process.platform === "win32" ? "junction" : "dir"
  )
  await assert.rejects(readWorkspaceImage(root, "linked/photo.png"), {
    code: "LINK",
  })
})
