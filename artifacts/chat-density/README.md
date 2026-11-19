# Chat density pass — 2026-11-19

## Evidence

Reference: a saved DOM export of `app.clawsgo.ai/chat/...` (dark theme), read
directly. Token values resolve from that page's stylesheet
`app.clawsgo.ai/assets/index-BX0A8ZDO.css` — the HTML carries only class names.

The reference chat column is `flex flex-col p-4 mx-auto w-full max-w-2xl gap-6
px-4 py-6`: **672px**, 16px side padding, 24px block gap. This project already
matched it exactly (`MessageScrollerContent` = `max-w-2xl gap-6 px-4 py-6`), so
column width, side padding and block gap were never the problem.

The reference step row is `flex min-w-0 flex-1 items-center gap-2 py-2 text-left
text-[15px] font-medium leading-6 text-muted-foreground`: **40px** tall from
8px padding + a 24px line box, 15px icon, 12px tabular duration on the right.
Rows live in a bare `flex flex-col` — **zero gap between rows** — and the list
wrapper carries `-my-2` to trim the first and last row's padding.

Our `TraceLine` was already `min-h-6 py-2 type-step` (15/24/500), i.e. the same
40px row. The difference was the container.

## Changes

| File | Change | Effect |
| --- | --- | --- |
| `components/ui/trace.tsx` | `Trace` drops `gap-2`, gains `-my-2` | Row pitch 48px → 40px; a 46-step run is ~370px shorter |
| `components/ui/trace.tsx` | `TraceCollapsibleContent` inner: `mt-2` → `mt-0`, `ml-[calc(--spacing(2)-1px)]` → `ml-[7px]`, `border-l` → `border-l-2` | Detail block sits flush under its row; the 2px rule aligns under the 15px icon's centre |
| `components/chat-message-actions.tsx` | Copy/remember strip is `hidden` until `group-hover/message` or `group-focus-within/message`; `[@media(hover:none)]:flex` keeps it for touch | Idle messages no longer reserve a row for controls |

The action strip uses `display` rather than a zero height because
`MessageContent` has `gap-2`: a zero-height child would still contribute 8px.

## Verification

Rendered measurement through the DevTools protocol against the real dev server,
1440 × 900 at DPR 1, on a temporary `/chat-density-check` route that mounted the
real `ChatTranscript` with a fixed message list (no model calls, no database).
The route was removed afterwards.

| Measured | Reference | Ours |
| --- | --- | --- |
| Step row height | 40px | **40px** |
| Gap between step rows | 0px | **0px** |
| Column max-width | 672px | **672px** |
| Block gap | 24px | **24px** |
| Column padding | 16px / 24px | **24px** (py-6 / px-4 → 24 top, 24 left) |
| Trace vertical trim | −8px | **−8px** |

The column-padding row reads 24/24 because `p-4` then `py-6`/`px-4` resolve to
24px top and 24px left in ours; the reference's own `p-4 px-4 py-6` resolves the
same way.

Checks: `npx eslint` on both changed files passed; `npm run typecheck` passed;
`npm test` 103 + 83 tests, 0 failures.

## Not changed

- Step-row typography (15/24/500) and the 40px row already matched.
- The reference shows a per-row duration (`3s`, `12.0s`, `13.7s`) with
  `text-xs tabular-nums`. This app does not record per-part timings, so adding
  the column needs a data change, not a style change. Recorded here so it is not
  mistaken for an oversight.
- The reference's collapse toggle has a 1px bottom divider and a 300ms
  `grid-template-rows` expansion. Ours has neither; adding them is a separate
  behaviour change.

Screenshot: `after.png` (dark, 1440 × 900).
