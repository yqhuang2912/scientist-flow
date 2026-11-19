# File upload — 2026-11-19

Two entry points. They deliberately have different destinations.

## 1. Chat attachments → `workspace/uploads/`

A file attached in the composer is saved into the task's `uploads/` folder
**and** carried on the message as a file part.

| Step | Where |
| --- | --- |
| Pick or drop | `components/chat-composer.tsx` — `+` button in the bottom-left, or drop anywhere over the form |
| Validate | `lib/chat-composer.ts` — `attachmentRejection` |
| Save to the task | `components/chat-interface.tsx` → `saveChatAttachmentAction` → `lib/workspace.server.ts` → `ensureUploadsDirectory` + `uploadFileToWorkspace` |
| Message part | `file` part with `mediaType`, `filename`, a data URL, and `workspacePath` |

Why both: the data URL is what the model reads directly, and the stored copy is
what survives the tab closing and what the model's file tools can operate on.
The `uploads/` folder is created on first use and is a single level under the
task root — no caller-supplied parents are filled in.

Constraints:

- The turn needs words **or** an attachment; an empty send is still refused.
- Rejected before listing: empty files, over 4 MiB in the composer, unsupported
  media types. The composer limit is larger than the 256 KiB workspace limit
  because the composer file is not necessarily written to the task.
- Dropping the same file twice adds one chip (name + size + `lastModified`).
- Accepted: png, jpeg, webp, gif, avif, pdf, plain, markdown, csv, json.
- A successful send clears text and attachments; a failed send restores both.
- An upload never overwrites: creation is exclusive, so a repeated name fails
  instead of destroying the earlier copy.

## 2. Workspace uploads → the folder that started them

| Piece | Where |
| --- | --- |
| Toolbar button (task root) | `components/research-workspace.tsx` |
| "Upload files" on a folder's row and context menu | `components/workspace-file-tree.tsx` |
| Server action | `actions/workspace.ts` → `uploadWorkspaceFileAction` |
| Write | `lib/workspace-file.server.ts` → `uploadFileToWorkspace` |

- The destination is captured when the picker opens, so expanding or collapsing
  a folder while the OS dialog is up cannot move the files.
- Written one at a time; the first failure stops the batch, naming the file and
  the reason, so a partial batch never reads as success.
- Exclusive create (`wx`), and a failed write is unlinked rather than left under
  the requested name.
- Names go through `workspaceFileNameSchema` — the same reserved-name, control
  character and trailing-space rules as a hand-created file.
- Limit is 256 KiB, matching `MAX_DOCUMENT_BYTES`, so every upload can be opened
  and re-saved in the workbench.
- The parent branch refreshes only after at least one file landed.

## Verification

- `npx tsc --noEmit`: passed.
- `npx eslint` on all ten changed files: passed.
- `npm test`: 103 server + 83 client tests, 0 failures.

One test caught a real mistake mid-work: `chatComposerSchema` was first tightened
so `files` was required, which broke the existing contract that
`parse({ text })` succeeds. `files` is now optional and normalised to `[]`.

Rendered through the DevTools protocol at 1440 × 700 DPR 2, dark theme, on a
temporary `/composer-check` route mounting the real `ChatComposer` (no model
calls). Removed afterwards.

- `+` button, bot picker and send control render in the expected order.
- Injecting two files through the real hidden input produced two chips reading
  `notes.md / 11 B` and `data.csv / 7 B`, each with a remove control.
- Screenshot: `composer-attachments.png`.

Not exercised end to end: sending a turn with attachments (needs a configured
Trigger project), and either upload path against a live task directory. Those
paths are covered by typecheck and lint only.

## Direction changed during the work

The first cut wrote workspace uploads into a shared `uploads/` folder. That was
rejected — workspace uploads must go into the folder they were started from, so
the `uploads/` folder now belongs to chat attachments only.
