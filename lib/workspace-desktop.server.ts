import "server-only"
import { spawn } from "node:child_process"
import path from "node:path"
import { WorkspaceDirectoryError } from "./workspace-directory.server"

// Fixed programs only. Paths are data in environment variables, never executable
// command text. .NET uses the Windows file association API, not cmd.exe/start.
const CHECK_PATH_SCRIPT = `
function Assert-RegularFile([string] $filePath) {
  $attributes = [IO.File]::GetAttributes($filePath)
  if (($attributes -band [IO.FileAttributes]::Directory) -ne 0 -or ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 5 }
  $parentPath = [IO.Path]::GetDirectoryName($filePath)
  while ($parentPath) {
    $attributes = [IO.File]::GetAttributes($parentPath)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 5 }
    $parentPath = [IO.Path]::GetDirectoryName($parentPath)
  }
}
`
const OPEN_SCRIPT =
  CHECK_PATH_SCRIPT +
  `
$ErrorActionPreference = 'Stop'
if (-not [Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) { exit 3 }
try {
  Assert-RegularFile ([Environment]::GetEnvironmentVariable('SF_DOCUMENT_TARGET'))
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = [Environment]::GetEnvironmentVariable('SF_DOCUMENT_TARGET')
  $info.UseShellExecute = $true
  $info.Verb = 'open'
  [void][Diagnostics.Process]::Start($info)
} catch { exit 4 }
`
const REPLACE_SCRIPT =
  CHECK_PATH_SCRIPT +
  `
$ErrorActionPreference = 'Stop'
try {
  $targetPath = [Environment]::GetEnvironmentVariable('SF_DOCUMENT_TARGET')
  Assert-RegularFile $targetPath
  Assert-RegularFile ([Environment]::GetEnvironmentVariable('SF_DOCUMENT_SOURCE'))
  $stream = [IO.File]::Open($targetPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    if ($stream.Length -gt 262144) { exit 6 }
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
    if ($hash -ne [Environment]::GetEnvironmentVariable('SF_DOCUMENT_VERSION')) { exit 6 }
  } finally { $stream.Dispose() }
  [IO.File]::Replace([Environment]::GetEnvironmentVariable('SF_DOCUMENT_SOURCE'), [Environment]::GetEnvironmentVariable('SF_DOCUMENT_TARGET'), [NullString]::Value)
} catch [IO.FileNotFoundException] { exit 2 } catch { exit 4 }
`

function runWindowsHelper(script: string, variables: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const executable = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    )
    const child = spawn(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, ...variables },
      }
    )
    const timer = setTimeout(() => {
      child.kill()
      reject(
        new WorkspaceDirectoryError(
          "TIMEOUT",
          "The desktop file operation timed out. Please check the file and retry."
        )
      )
    }, 15000)
    child.once("error", () => {
      clearTimeout(timer)
      reject(
        new WorkspaceDirectoryError(
          "INACCESSIBLE",
          "The Windows file adapter is unavailable."
        )
      )
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else if (code === 6)
        reject(
          new WorkspaceDirectoryError(
            "CONFLICT",
            "The file changed on disk. Your draft has been kept."
          )
        )
      else if (code === 5)
        reject(
          new WorkspaceDirectoryError(
            "LINK",
            "The file path contains a link or is not a regular file."
          )
        )
      else
        reject(
          new WorkspaceDirectoryError(
            code === 2 ? "NOT_FOUND" : "INACCESSIBLE",
            code === 2
              ? "The file no longer exists. Your draft has been kept."
              : "Windows could not complete the file operation. Check permissions or the default application."
          )
        )
    })
  })
}

export function replaceExistingWindowsFile(
  source: string,
  target: string,
  expectedHash: string
) {
  return runWindowsHelper(REPLACE_SCRIPT, {
    SF_DOCUMENT_SOURCE: source,
    SF_DOCUMENT_TARGET: target,
    SF_DOCUMENT_VERSION: expectedHash,
  })
}

export function isLocalDesktopRequest(headers: {
  get(name: string): string | null
}) {
  if (
    process.platform !== "win32" ||
    process.env.WORKSPACE_DESKTOP_OPEN !== "1" ||
    process.env.CI ||
    process.env.VERCEL
  )
    return false
  // Next supplies these headers even for a direct connection to its loopback listener.
  const peer = headers.get("x-forwarded-for")
  const forwardedHost = headers.get("x-forwarded-host")
  if (
    headers.get("forwarded") ||
    (peer !== null &&
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)) ||
    (forwardedHost !== null && forwardedHost !== headers.get("host"))
  )
    return false
  try {
    const origin = new URL(headers.get("origin") ?? "")
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) &&
      origin.host === headers.get("host") &&
      ["http:", "https:"].includes(origin.protocol)
    )
  } catch {
    return false
  }
}

export function requestDesktopOpen(absolute: string) {
  return runWindowsHelper(OPEN_SCRIPT, { SF_DOCUMENT_TARGET: absolute })
}
