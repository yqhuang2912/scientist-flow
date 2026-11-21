import { workspaceFileTargetSchema } from "./workspace-validation"

export type WorkspaceOpenPolicy =
  | { kind: "internal-text"; markdown: boolean }
  | { kind: "data-json-preview" }
  | { kind: "internal-image" }
  | { kind: "external" }
  | { kind: "blocked" | "unsupported"; reason: string }

// Ordered, shared by the tree entry point and every server-side read/open/save.
export const BLOCKED_WORKSPACE_REGIONS = ["data", "outputs/checkpoints"]
export function isBlockedWorkspaceRegion(relativePath: string) {
  const lower = relativePath.toLowerCase()
  return BLOCKED_WORKSPACE_REGIONS.some(
    (region) => lower === region || lower.startsWith(region + "/")
  )
}
export const BLOCKED_FILE_EXTENSIONS = [
  ".csv",
  ".tsv",
  ".parquet",
  ".arrow",
  ".feather",
  ".npy",
  ".npz",
  ".h5",
  ".hdf5",
  ".hdf",
  ".dcm",
  ".dicom",
  ".nii",
  ".nii.gz",
  ".pt",
  ".pth",
  ".ckpt",
  ".safetensors",
  ".onnx",
  ".gguf",
  ".ggml",
]
const TEXT_EXTENSIONS = [
  ".md",
  ".markdown",
  ".txt",
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".scss",
  ".html",
  ".htm",
  ".tex",
  ".bib",
  ".xml",
  ".ini",
  ".cfg",
  ".conf",
  ".config",
  ".sh",
  ".r",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".sql",
  ".log",
]
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
])
// SVG and macro-enabled Office formats are deliberately excluded.
const EXTERNAL_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]

export function workspaceOpenPolicy(rawPath: string): WorkspaceOpenPolicy {
  const parsed = workspaceFileTargetSchema.safeParse(rawPath)
  if (!parsed.success)
    return { kind: "blocked", reason: "Invalid workspace file path." }
  const relative = parsed.data.toLowerCase()
  if (relative.startsWith("data/") && relative.endsWith(".json"))
    return { kind: "data-json-preview" }
  if (
    isBlockedWorkspaceRegion(relative) ||
    BLOCKED_FILE_EXTENSIONS.some((extension) => relative.endsWith(extension))
  ) {
    return {
      kind: "blocked",
      reason: "Dataset and model-weight files cannot be opened here.",
    }
  }
  if (TEXT_EXTENSIONS.some((extension) => relative.endsWith(extension))) {
    return {
      kind: "internal-text",
      markdown: /\.(md|markdown)$/.test(relative),
    }
  }
  if (IMAGE_EXTENSIONS.has(relative.slice(relative.lastIndexOf("."))))
    return { kind: "internal-image" }
  if (EXTERNAL_EXTENSIONS.some((extension) => relative.endsWith(extension)))
    return { kind: "external" }
  return { kind: "unsupported", reason: "This file format is not supported." }
}
