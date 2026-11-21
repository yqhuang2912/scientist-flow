import { workspaceOpenPolicy } from "./workspace-open-policy"

type Reader =
  | "text"
  | "image"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "legacy-office"
  | "preview-image"
type AttachmentFormat = { reader: Reader; mediaType: string }

const plainText: AttachmentFormat = { reader: "text", mediaType: "text/plain" }
const formats: (AttachmentFormat & { extensions: string[] })[] = [
  {
    ...plainText,
    extensions: [
      "txt",
      "pyi",
      "mts",
      "cts",
      "cc",
      "cxx",
      "cs",
      "swift",
      "kt",
      "php",
      "rb",
      "lua",
      "bash",
      "zsh",
      "ps1",
      "psm1",
      "sass",
      "diff",
      "patch",
      "rst",
      "rmd",
    ],
  },
  {
    extensions: ["md", "markdown", "mdx"],
    reader: "text",
    mediaType: "text/markdown",
  },
  { extensions: ["csv"], reader: "text", mediaType: "text/csv" },
  {
    extensions: ["tsv"],
    reader: "text",
    mediaType: "text/tab-separated-values",
  },
  {
    extensions: ["json", "ipynb"],
    reader: "text",
    mediaType: "application/json",
  },
  {
    extensions: ["jsonl", "ndjson"],
    reader: "text",
    mediaType: "application/x-ndjson",
  },
  { extensions: ["png"], reader: "image", mediaType: "image/png" },
  { extensions: ["jpg", "jpeg"], reader: "image", mediaType: "image/jpeg" },
  { extensions: ["webp"], reader: "image", mediaType: "image/webp" },
  { extensions: ["gif"], reader: "image", mediaType: "image/gif" },
  { extensions: ["avif"], reader: "image", mediaType: "image/avif" },
  { extensions: ["tif", "tiff"], reader: "image", mediaType: "image/tiff" },
  { extensions: ["bmp"], reader: "preview-image", mediaType: "image/bmp" },
  { extensions: ["ico"], reader: "preview-image", mediaType: "image/x-icon" },
  { extensions: ["pdf"], reader: "pdf", mediaType: "application/pdf" },
  {
    extensions: ["docx"],
    reader: "docx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    extensions: ["xlsx"],
    reader: "xlsx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    extensions: ["pptx"],
    reader: "pptx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  {
    extensions: ["doc"],
    reader: "legacy-office",
    mediaType: "application/msword",
  },
  {
    extensions: ["xls"],
    reader: "legacy-office",
    mediaType: "application/vnd.ms-excel",
  },
  {
    extensions: ["ppt"],
    reader: "legacy-office",
    mediaType: "application/vnd.ms-powerpoint",
  },
]

export function chatAttachmentFormat(
  path: string,
  mime = ""
): AttachmentFormat | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  const dot = name.lastIndexOf(".")
  const extension = dot < 0 ? "" : name.slice(dot + 1)
  const format = formats.find((entry) => entry.extensions.includes(extension))
  if (format) return format
  // Reuse the workspace's source/configuration formats, including .log.
  const policy = workspaceOpenPolicy(name)
  if (
    policy.kind === "internal-text" ||
    [
      "dockerfile",
      "makefile",
      "readme",
      "license",
      ".gitignore",
      ".editorconfig",
    ].includes(name)
  )
    return plainText
  if (
    policy.kind === "blocked" ||
    /\.(?:exe|msi|dll|com|lnk|url|svgz?|docm|pptm|xlsm)$/.test(name)
  )
    return
  // Some systems provide a recognised MIME type for files with no standard suffix.
  const mediaType = mime.split(";", 1)[0].trim().toLowerCase()
  return formats.find((entry) => entry.mediaType === mediaType)
}
