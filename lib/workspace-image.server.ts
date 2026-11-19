import "server-only"
import { WorkspaceDirectoryError } from "./workspace-directory.server"
import { readWorkspaceFileBytes } from "./workspace-file.server"
import { workspaceOpenPolicy } from "./workspace-open-policy"

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024

// Camera/export tools sometimes give JPEG bytes a .png filename. Serve the
// detected raster MIME type, after the file has passed workspace policy.
function rasterType(bytes: Buffer) {
  const ascii = (start: number, end: number) =>
    bytes.toString("latin1", start, end)
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png"
  if (ascii(0, 3) === "\xff\xd8\xff") return "image/jpeg"
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif"
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp"
  if (ascii(0, 2) === "BM") return "image/bmp"
  if (ascii(0, 4) === "\x00\x00\x01\x00") return "image/x-icon"
  if (["II*\x00", "MM\x00*", "II+\x00", "MM\x00+"].includes(ascii(0, 4)))
    return "image/tiff"
  if (ascii(4, 8) === "ftyp" && bytes.length >= 16) {
    const end = Math.min(bytes.length, bytes.readUInt32BE(0))
    for (let i = 8; i + 4 <= end; i += 4) {
      if (i !== 12 && ["avif", "avis"].includes(ascii(i, i + 4)))
        return "image/avif"
    }
  }
}

export async function readWorkspaceImage(taskDir: string, relative: string) {
  const policy = workspaceOpenPolicy(relative)
  if (policy.kind !== "internal-image")
    throw new WorkspaceDirectoryError(
      "UNSUPPORTED",
      "This file cannot be previewed as an image."
    )
  const { raw } = await readWorkspaceFileBytes(
    taskDir,
    relative,
    MAX_IMAGE_BYTES,
    "Image previews are limited to 32 MiB."
  )
  const type = rasterType(raw)
  if (!type)
    throw new WorkspaceDirectoryError(
      "INVALID_IMAGE",
      "This file does not contain a supported raster image."
    )
  if (type === "image/tiff") {
    // Browsers do not consistently decode TIFF. Render only its first page.
    const { default: sharp } = await import("sharp")
    try {
      const bytes = await sharp(raw, { pages: 1, limitInputPixels: 40_000_000 })
        .autoOrient()
        .resize({
          width: 4096,
          height: 4096,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer()
      return { bytes, type: "image/png" }
    } catch {
      throw new WorkspaceDirectoryError(
        "INVALID_IMAGE",
        "This TIFF could not be decoded within the preview limit."
      )
    }
  }
  return { bytes: raw, type }
}
