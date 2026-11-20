import "server-only"
import path from "node:path"
import type { FileUIPart, TextUIPart } from "ai"
import type { StoredAttachment, PreparedAttachment } from "./chat-composer"
import { readWorkspaceFileBytes } from "./workspace-file.server"
import { MAX_UPLOAD_BYTES } from "./workspace-validation"
import { officeAttachmentText } from "./office-attachment.server"

const MAX_CHARS = 16_000
type Part = TextUIPart | FileUIPart
const notice = (text: string): TextUIPart => ({ type: "text", text })

async function pdfText(bytes: Buffer) {
  const { getDocumentProxy } = await import("unpdf")
  const doc = await getDocumentProxy(new Uint8Array(bytes), {
    useSystemFonts: false,
  })
  try {
    let text = ""
    const pages = Math.min(doc.numPages, 40)
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const lines = content.items
        .flatMap((item) =>
          "str" in item ? [item.str, item.hasEOL ? "\n" : " "] : []
        )
        .join("")
        .trim()
      if (lines) text += "Page " + n + "\n" + lines + "\n\n"
      if (text.length > MAX_CHARS) break
    }
    if (pages < doc.numPages && text && text.length <= MAX_CHARS)
      text += "\n[Only the first 40 pages were checked.]"
    return text.trim()
  } finally {
    await doc.loadingTask.destroy()
  }
}

async function readAttachment(
  taskDir: string,
  ref: StoredAttachment,
  imageBudget: number,
  textBudget: number
): Promise<Part> {
  const ext = path.posix.extname(ref.relativePath).toLowerCase()
  const title = JSON.stringify(ref.name)
  const office = [".docx", ".pptx", ".xlsx"].includes(ext)
  const image = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"].includes(
    ext
  )
  if (
    !office &&
    !image &&
    ![".pdf", ".txt", ".md", ".markdown", ".json", ".csv"].includes(ext)
  )
    return notice(
      "Attachment " +
        title +
        ": this format cannot be read. For legacy Office documents, request a DOCX, PPTX or XLSX copy."
    )
  const prefixBytes =
    office || image || ext === ".pdf" ? undefined : (MAX_CHARS + 1) * 4
  const { raw, target } = await readWorkspaceFileBytes(
    taskDir,
    ref.relativePath,
    Math.min(ref.size, MAX_UPLOAD_BYTES),
    "Attachment exceeds the read limit.",
    prefixBytes
  )
  if (target.stat.size !== BigInt(ref.size))
    return notice(
      "Attachment " +
        title +
        " changed size after upload. Request the current file."
    )
  if (image) {
    const { default: sharp } = await import("sharp")
    const picture = sharp(raw, { pages: 1, limitInputPixels: 64_000_000 })
    const { format, width, height } = await picture.metadata()
    if (!["png", "jpeg", "gif", "webp", "heif", "avif"].includes(format ?? ""))
      throw new Error("Invalid raster")
    if (
      raw.length <= imageBudget &&
      width <= 1536 &&
      height <= 1536 &&
      ["png", "jpeg", "webp", "gif"].includes(format)
    ) {
      const mediaType = "image/" + format
      return {
        type: "file",
        mediaType,
        filename: ref.name,
        url: `data:${mediaType};base64,${raw.toString("base64")}`,
      }
    }
    for (const width of [1536, 1024, 768, 512]) {
      const data = await picture
        .clone()
        .autoOrient()
        .resize({
          width,
          height: width,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#fff" })
        .jpeg({ quality: 78 })
        .toBuffer()
      if (data.length <= imageBudget)
        return {
          type: "file",
          mediaType: "image/jpeg",
          filename: ref.name,
          url: "data:image/jpeg;base64," + data.toString("base64"),
        }
    }
    throw new Error("Image exceeds model input budget")
  }
  let text: string
  if (office) text = await officeAttachmentText(raw, ext, MAX_CHARS)
  else if (ext === ".pdf") text = await pdfText(raw)
  else {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw, {
      stream: raw.length < ref.size,
    })
    if (text.includes("\0")) throw new Error("Invalid text")
  }
  if (!text.trim()) {
    if (ext === ".pdf" && raw.length <= imageBudget)
      return {
        type: "file",
        mediaType: "application/pdf",
        filename: ref.name,
        url: "data:application/pdf;base64," + raw.toString("base64"),
      }
    return notice(
      "Attachment " +
        title +
        " contains no extractable text in the inspected pages. Scans and embedded pictures have not been transcribed."
    )
  }
  const cropped = Buffer.from(text.slice(0, MAX_CHARS)).subarray(0, textBudget)
  const excerpt = new TextDecoder().decode(cropped, { stream: true })
  return notice(
    "Text extracted from attachment " +
      title +
      " (user-provided document):\n" +
      excerpt +
      (text.length > excerpt.length ? "\n[Excerpt truncated.]" : "")
  )
}

// Prepare bounded model inputs on the machine that owns the task directory.
export async function prepareSavedAttachments(
  taskDir: string,
  refs: StoredAttachment[]
): Promise<PreparedAttachment[]> {
  const result: PreparedAttachment[] = []
  const mediaCount = refs.filter((ref) =>
    /\.(png|jpe?g|webp|gif|avif|pdf)$/i.test(ref.relativePath)
  ).length
  const imageBudget = Math.floor((250 * 1024) / Math.max(1, mediaCount))
  const textBudget = Math.floor((96 * 1024) / Math.max(1, refs.length))
  for (const ref of refs) {
    let part: Part
    try {
      if (
        ref.relativePath.split("/").length !== 2 ||
        !ref.relativePath.startsWith("uploads/")
      )
        throw new Error("Invalid attachment")
      part = await readAttachment(taskDir, ref, imageBudget, textBudget)
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT"
      part = notice(
        "Could not read attachment " +
          JSON.stringify(ref.name) +
          (missing
            ? ". It is no longer in this task."
            : ". The file is inaccessible, invalid, protected or over the processing limit.")
      )
    }
    result.push({ reference: ref, part })
  }
  return result
}
