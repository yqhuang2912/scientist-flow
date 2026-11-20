# Single-document file workbench

The dashboard layout owns `WorkspaceDocumentProvider`, whose stable context
contains a `DocumentSessionStore`. Only `DocumentWindow` subscribes to document
updates. Chat, its transport and its composer do not subscribe and are never
keyed, stopped or recreated by file operations. The window is a nonmodal dialog
without an overlay, focus lock or outside-dismiss. It survives chat navigation
within the dashboard. Browser refresh still leaves the application; dirty drafts
use `beforeunload`, without promising crash recovery.

## Opening and editing

The existing Base File Tree selects on click and opens on double-click, Enter,
or its shared Open menu action. `lib/workspace-open-policy.ts` owns all routing:

- UTF-8 Markdown, plain text, common source and configuration files open inside.
- Chat image attachments, Markdown images in messages, and workspace raster files
  open in the image preview. Relative Markdown image paths use the current task.
  Fit to window and Actual size share the same source. Workspace images are limited
  to 32 MiB. TIFF previews show the first page at up to 4096 pixels per side.
- PDF and ordinary Word/Excel/PowerPoint files use the local desktop adapter.
  SVG and macro-enabled Office formats are excluded.
- `data/**`, `outputs/checkpoints/**`, the listed dataset extensions and model
  weights take precedence over every supported file type. Their bodies are not
  read to classify them.
- Other types, executables and shortcuts stay unsupported.

The policy is checked again on the server before content access or desktop
launch. Text reads and writes are limited to 256 KiB including the BOM and line
endings. UTF-8 decoding is strict; binary control characters are refused. HTML,
LaTeX, scripts and Mermaid remain source. The Markdown preview uses the installed
Streamdown renderer with raw HTML processing removed, inert code blocks and an
image placeholder. It cannot automatically load remote images or embedded media.
Explicit http/https/mailto links remain links.

Document identity is captured on open. Save always sends the original chat ID,
relative path and base version, even when another task is visible. Preview uses
the same current buffer as Source. Source stays mounted across mode changes and
minimization. Dirty is a buffer comparison; save acknowledges only the submitted
revision, retaining newer input. Closing, switching or reloading dirty text uses
Save and continue / Discard changes / Cancel. A failed save never continues.

An active-document deletion first resolves its draft. Discard is deferred until
the existing file/folder deletion succeeds, so cancelling or failing deletion
preserves text. A deleted document remains visible as missing with its buffer
available for copying; Save cannot recreate it. Submitted deletion results reach
the persistent session even if the tree has unmounted during chat navigation.
An explicit tree refresh checks the active document without replacing its draft.
There is no background polling or file watcher.

## Uploads

Workspace and chat accept individual files up to 200 MB (200,000,000 bytes).
The browser streams each file to the task's upload route and reports transfer
progress until the server confirms the write. Workspace uploads target the
selected destination and reject name collisions. Composer attachments go into
`uploads/` and receive a numbered suffix on collision.

The composer accepts Word, Excel, PowerPoint, PDF, supported raster images,
plain text, Markdown, CSV and JSON. The application reads the saved upload on
the workspace host before sending the message. DOCX (including comments), PPTX
(slide text), XLSX (cell values), text PDFs and UTF-8 text supply labeled
excerpts. Legacy binary Office files carry an explicit unavailable notice.
Extraction checks up to 40 PDF pages and 16,000 characters per file, subject to
a shared 96 KiB excerpt budget. Scanned PDFs that fit the media budget can be
sent to PDF-capable models. There is no local OCR.

Images supply actual raster data, downscaled when needed to fit the shared
250 KiB media budget. The original upload remains available for click-to-open
preview. Attachment cards show filenames and sizes. A follow-up can recover
older path-only references from the same chat and include their contents once.

## Filesystem boundary and writes

Actions reuse `requireWorkspaceBinding`, the existing real-chat lookup (this
local development app has no separate user ACL), and `withDirectoryWrite`.
Only the saved server binding determines the root. Every directory component,
including binding ancestors, is checked for links/junctions. Reads verify the
opened file descriptor against the checked ordinary file and recheck the path
and timestamps afterward. The version includes path/file identity and a SHA-256
content digest.

Saving stages an exclusive temporary file in the same parent and syncs it before
revalidating the target and base version. Windows uses .NET `File.Replace`, which
requires an existing destination; it never falls back to delete-and-create.
The fixed Windows helper rechecks path attributes and the content hash immediately
before replacement. Paths are environment data, never interpolated command text.
Other hosts use Node's same-directory rename after revalidation. Temporary cleanup
also rechecks parent identity. Original permissions, BOM and line endings are
retained where supported. For mixed endings, existing line indices retain their
ending and new lines use the first original ending; this is not a full line diff.

The queue serializes this Node process's writes, including creates and ancestor
deletions. It is not a cross-process filesystem lock. An external writer can still
race the final OS operation; checks substantially narrow that interval but do not
claim an OS-level compare-and-swap or transactional filesystem. Non-Windows rename
does not have Windows File.Replace's existing-destination guarantee. Run one local
application writer per workspace. Root migration remains outside this feature.

## Optional desktop opening

Desktop opening is disabled by default and implemented only for Windows. To
enable it, set `WORKSPACE_DESKTOP_OPEN=1` **only on the user's interactive desktop**
and bind the server to loopback, for example:

```powershell
npm run dev -- --hostname 127.0.0.1
# Or, after building:
npm run start -- --hostname 127.0.0.1
```

Use a localhost/127.0.0.1 browser URL. The action refuses nonlocal origins,
nonlocal forwarded addresses, proxy chains, CI and Vercel environments. The
loopback peer and matching host supplied by Next.js are accepted. Next.js also checks action
origins. The helper checks `UserInteractive` and refuses Windows session 0.
Loopback Host/Origin headers alone do not prove locality behind a tunnel or proxy;
do not enable the flag when exposing or forwarding the service to remote clients.

The helper passes one revalidated file to `.NET ProcessStartInfo` with
`UseShellExecute=true` and the `open` verb. It does not accept a program, command,
arguments or URL from a client, does not invoke cmd.exe/start, and does not wait for
the associated application to exit. UI feedback says only Requested system open.
External edits and saving belong to that application.

## Checks

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression; fnm use 22
$env:NODE_OPTIONS='--conditions=react-server'
npx tsx --test tests/workspace-document.test.ts tests/document-session.test.ts
Remove-Item Env:NODE_OPTIONS
npm run typecheck
npm run build
```

Filesystem tests create isolated directories under the system temp directory.
The session tests use controlled deferred responses for races, saved-buffer
acknowledgment, cancellation, conflicts and deletion. The optional
`tests/fixtures/document-workbench.tsx` composes the real window with the existing
simulated AI SDK chat fixture. Mount it temporarily behind a development-only
route, pointing at a disposable file in a real task; remove the route afterward.
It makes no model or experiment requests.

Design references: [Lattice design system](https://github.com/leo1oel/lattice/blob/main/docs/design-system.md)
and [codebase map](https://github.com/leo1oel/lattice/blob/main/docs/codebase-map.md),
mapped onto this project's [compact UI](./interface-style.md).
API references: [.NET default association opening](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.useshellexecute)
and [File.Replace](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace).
