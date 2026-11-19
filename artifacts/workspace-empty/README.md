# Workspace empty state — 2026-11-19

## Problem

The workspace panel rendered its two "nothing here yet" states differently. The
`not-initialised` state already used the shared `Empty` composition; the
`no-config` state above it was a hand-built `<div>` + paragraph + button. The
result was a bare sentence and a button floating at the top-left of the panel,
with no icon, no title hierarchy, and a text size (12px) that matched neither
the other empty state nor the panel's own rows.

`docs/interface-style.md` and the installed shadcn rules both say empty states
use `Empty`; this was the one place that did not.

## Change

`components/research-workspace.tsx` — the `no-config` branch now composes
`Empty` exactly like the `not-initialised` branch beside it:

| Part | Value |
| --- | --- |
| Media | `variant="icon"`, `FolderOpenIcon` |
| Title | No workspace directory |
| Description | Choose a root directory to hold this task's files. |
| Content | `Button variant="outline" size="sm"` — Set workspace directory |
| Container | `Empty className="px-4 py-8"`, matching the sibling state |

The button keeps the settings icon via `data-icon="inline-start"` and still
calls `onOpenSettings`. It renders only when `onOpenSettings` is provided, as
before. Copy moved from a fragment ("No workspace root directory configured.")
to a title + description pair, which is what `Empty` is built to hold.

## Verification

- `npx eslint components/research-workspace.tsx`: passed.
- `npm run typecheck`: passed.
- `npm test`: 103 server + 83 client tests, 0 failures.
- Rendered with the real `Empty` composition on a temporary
  `/workspace-empty-check` route at 1440 × 900 DPR 2, dark theme. The route was
  removed afterwards. Screenshot: `after.png`.

Limits of this check: the live workspace panel could not be exercised end to
end. The chat page stalls at "Loading conversation…" for this environment
(the transcript loader needs Trigger credentials that are not configured), and
the workspace panel stalled at "Loading workspace…" while the status request was
outstanding. The screenshot therefore shows the empty state rendered in the
panel's real width and theme, not the full panel lifecycle.

Not changed: `not-initialised` already used `Empty` and was left as it was.
