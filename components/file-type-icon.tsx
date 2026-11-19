import type { ReactNode } from "react"

import {
  fileGlyphs,
  folderGlyphs,
  folderSilhouettes,
} from "@/components/icons/material-file-glyphs"
import { cn } from "@/lib/utils"

type Format = { icon: keyof typeof fileGlyphs; name: RegExp; mime?: RegExp }

// Presentation only. Name matches are shared with the tree, while MIME covers
// chat attachments without a meaningful filename. Compound suffixes come first.
const formats: Format[] = [
  {
    icon: "ms-word",
    name: /\.(docx?|docm|rtf|odt)$/,
    mime: /msword|wordprocessingml|ms-word|opendocument\.text|\/rtf$/,
  },
  { icon: "pdf", name: /\.pdf$/, mime: /^application\/pdf$/ },
  {
    icon: "ms-excel",
    name: /\.(xlsx?|xlsm|ods)$/,
    mime: /ms-excel|spreadsheet/,
  },
  {
    icon: "ms-powerpoint",
    name: /\.(pptx?|pptm|odp)$/,
    mime: /powerpoint|presentation/,
  },
  { icon: "csv", name: /\.(csv|tsv)$/, mime: /\/csv$|tab-separated-values/ },
  { icon: "svg", name: /\.svgz?$/, mime: /^image\/svg\+xml$/ },
  {
    icon: "image",
    name: /\.(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|heic)$/,
    mime: /^image\//,
  },
  {
    icon: "markdown",
    name: /\.(md|markdown|mdx)$/,
    mime: /^text\/(x-)?markdown$/,
  },
  { icon: "jupyter", name: /\.ipynb$/, mime: /jupyter/ },
  {
    icon: "json",
    name: /\.(jsonc?|jsonl|ndjson)$/,
    mime: /[+/](json|ndjson)$/,
  },
  { icon: "yaml", name: /\.ya?ml$/, mime: /[+/](x-)?yaml$/ },
  { icon: "toml", name: /\.toml$/, mime: /[+/](x-)?toml$/ },
  { icon: "env", name: /^\.env(\..+)?$/ },
  { icon: "config", name: /\.(ini|cfg|conf)$|^\.(gitignore|editorconfig)$/ },
  { icon: "python", name: /\.(py|pyi)$/, mime: /python/ },
  { icon: "typescript-react", name: /\.tsx$/ },
  { icon: "typescript", name: /\.[cm]?ts$/, mime: /typescript/ },
  { icon: "javascript-react", name: /\.jsx$/ },
  { icon: "javascript", name: /\.[cm]?js$/, mime: /javascript/ },
  { icon: "bash", name: /\.(sh|bash|zsh)$/, mime: /(x-sh|shellscript)$/ },
  { icon: "powershell", name: /\.(ps1|psm1)$/ },
  { icon: "html", name: /\.html?$/, mime: /[+/]html$/ },
  { icon: "xml", name: /\.xml$/, mime: /[+/]xml$/ },
  { icon: "css", name: /\.css$/, mime: /\/css$/ },
  { icon: "sass", name: /\.s[ac]ss$/ },
  { icon: "c", name: /\.[ch]$/ },
  { icon: "cpp", name: /\.(cpp|cc|hpp)$/ },
  { icon: "go", name: /\.go$/ },
  { icon: "rust", name: /\.rs$/ },
  { icon: "java", name: /\.java$/ },
  { icon: "r", name: /\.r$/ },
  { icon: "latex", name: /\.(tex|bib)$/, mime: /(latex|bibtex)$/ },
  { icon: "docker", name: /^dockerfile(\..+)?$/ },
  { icon: "makefile", name: /^makefile$/ },
  { icon: "binary", name: /\.(pt|pth|ckpt|safetensors|onnx|gguf|ggml)$/ },
  {
    icon: "database",
    name: /\.(sql|parquet|arrow|feather|np[yz]|h5|hdf5?|dcm|dicom|nii(\.gz)?|db|sqlite3?)$/,
    mime: /parquet|arrow|dicom|\/sql$/,
  },
  {
    icon: "zip",
    name: /\.(zip|7z|rar|tar|tgz|gz|bz2|xz)$/,
    mime: /zip|compressed|x-tar/,
  },
  { icon: "audio", name: /\.(mp3|wav|flac|ogg|m4a)$/, mime: /^audio\// },
  { icon: "video", name: /\.(mp4|m4v|webm|mov|avi|mkv)$/, mime: /^video\// },
  { icon: "log", name: /\.log$/ },
  { icon: "text", name: /\.txt$/, mime: /^text\// },
]

type IconProps = {
  className?: string
  "data-icon"?: "inline-start"
}

function EntryIcon({
  symbol,
  viewBox,
  children,
  className,
  ...props
}: IconProps & { symbol: string; viewBox: string; children: ReactNode }) {
  return (
    <svg
      {...props}
      data-slot="file-type-icon"
      data-glyph={symbol}
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {children}
    </svg>
  )
}

export function FileTypeIcon({
  filename,
  mediaType,
  ...props
}: IconProps & { filename?: string; mediaType?: string }) {
  const name = filename?.split(/[\\/]/).pop()?.toLowerCase() ?? ""
  const mime = mediaType?.split(";")[0].trim().toLowerCase()
  const format =
    formats.find((format) => format.name.test(name)) ??
    (mime ? formats.find((format) => format.mime?.test(mime)) : undefined)
  const symbol = format?.icon ?? "file"
  const glyph = fileGlyphs[symbol]
  return (
    <EntryIcon symbol={symbol} viewBox={glyph.viewBox} {...props}>
      {glyph.art}
    </EntryIcon>
  )
}

const folderIcons = new Map<string, keyof typeof folderGlyphs>([
  ["data", "folder-database"],
  ["docs", "folder-docs"],
  ["src", "folder-src"],
  ["outputs", "folder-dist"],
  ["uploads", "folder-upload"],
  ["figures", "folder-images"],
  ["images", "folder-images"],
  ["models", "folder-packages"],
  ["checkpoints", "folder-packages"],
])

export function FolderTypeIcon({
  name = "",
  expanded = false,
  ...props
}: IconProps & { name?: string; expanded?: boolean }) {
  const symbol = folderIcons.get(name.toLowerCase()) ?? "folder"
  const glyph = folderGlyphs[symbol]
  return (
    <EntryIcon
      symbol={expanded ? `${symbol}-open` : symbol}
      viewBox="0 0 16 16"
      {...props}
    >
      <path
        d={expanded ? folderSilhouettes.open : folderSilhouettes.closed}
        fill={glyph.fill}
      />
      {glyph.badge && (
        <path
          d={glyph.badge}
          fill="light-dark(#eff1f5, #313244)"
          transform="translate(1.5 1.5) scale(.78)"
        />
      )}
    </EntryIcon>
  )
}
