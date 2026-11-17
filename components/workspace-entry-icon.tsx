import {
  BracesIcon,
  DatabaseIcon,
  FileCode2Icon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkspaceEntry } from "@/lib/workspace-validation"

// Presentation only: icons do not determine whether a file can be opened.
export function WorkspaceEntryIcon({
  entry,
  expanded = false,
}: {
  entry: WorkspaceEntry
  expanded?: boolean
}) {
  const extension = entry.name.toLowerCase().split(".").at(-1) ?? ""
  const folderZone = entry.relPath.split("/")[0].toLowerCase()
  let Icon = FileIcon
  let tone = "text-muted-foreground"
  if (entry.isDir) {
    Icon = expanded ? FolderOpenIcon : FolderIcon
    tone =
      folderZone === "src"
        ? "text-file-source"
        : folderZone === "outputs"
          ? "text-file-output"
          : folderZone === "models"
            ? "text-file-data"
            : folderZone === "docs" || folderZone === "report"
              ? "text-file-document"
              : "text-file-folder"
  } else if (
    [
      "py",
      "ts",
      "tsx",
      "js",
      "jsx",
      "r",
      "sh",
      "rs",
      "go",
      "c",
      "cpp",
    ].includes(extension)
  ) {
    Icon = FileCode2Icon
    tone = "text-file-source"
  } else if (
    ["json", "yaml", "yml", "toml", "xml", "ini", "cfg"].includes(extension)
  ) {
    Icon = BracesIcon
    tone = "text-file-folder"
  } else if (
    ["png", "jpg", "jpeg", "svg", "webp", "gif", "tif", "tiff"].includes(
      extension
    )
  ) {
    Icon = FileImageIcon
    tone = "text-file-image"
  } else if (
    ["md", "txt", "pdf", "doc", "docx", "tex", "bib"].includes(extension)
  ) {
    Icon = FileTextIcon
    tone = "text-file-document"
  } else if (
    [
      "csv",
      "tsv",
      "parquet",
      "npy",
      "npz",
      "pt",
      "pth",
      "ckpt",
      "joblib",
    ].includes(extension)
  ) {
    Icon = DatabaseIcon
    tone = "text-file-data"
  }
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", tone)} />
}
