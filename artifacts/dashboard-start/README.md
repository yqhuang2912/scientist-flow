# Dashboard start-task review — 2026-11-19

## Scope

Replaced the dashboard's bot-recruitment empty state with a task-start empty
state. The page no longer says "Meet your first bot"; it opens a task instead.
Existing filesystem, chat, task execution and Settings behavior are unchanged.
No commit, dependency, database or deployment change.

Changed:

- `app/(dashboard)/page.tsx` — server page loads bots and renders the start panel.
- `components/dashboard-start.tsx` (new) — client panel owning the task and bot
  dialogs.
- `components/task-dialog.tsx` — reverted to its original signature; no behavior
  change in the final state.

## Copy and states

| State | Portrait | Title | Description | Action |
| --- | --- | --- | --- | --- |
| Bots exist | 3-bot group portrait from the first three bots | Start a task | Name the task, choose the bots that work on it, then ask your first question. | New task → `TaskDialog` |
| No bots | Single DiceBear portrait | Add a bot first | Every task runs with at least one bot. Create one and give it a job to do. | Create a bot → `BotDialog` |

The "or start with one bot" list was built and then removed at the user's
request; the page is a single centered panel with no secondary list.

The panel uses the shared `Empty` composition rather than custom markup, one
primary `Button`, and `GroupChatAvatar` at 36 px. No new tokens, fonts, icon
colors or decorative chrome were introduced.

## Checks

- `npx eslint` on the three changed files: no errors.
- `npm run typecheck`: passed.
- `grep` for the old copy ("Meet your first bot") across the repo: nothing left
  outside `BotDialog`'s own trigger label.
- Chrome 157 via the DevTools protocol at DPR 2, real dev server on
  `localhost:3000`:
  - light 1440 × 900, dark 1440 × 900 — panel centered, both themes correct.
  - narrow 390 × 844 — sidebar trigger visible, copy wraps, no horizontal
    overflow.
  - Clicking New task opened the existing task dialog; name field, bot list with
    28 px portraits and 30 px rows, Cancel / Create task footer all intact.
  - No-bots state checked through a temporary `/dashboard-start-check` route
    (rendered `DashboardStart` with an empty bot array), then removed. Copy
    read: "Add a bot first / Every task runs with at least one bot… / Create a
    bot".
- Theme was forced through `localStorage` and the `html` class in the headless
  session only; no saved preference was changed.

Not exercised: real task creation, chat navigation after creation, or the bot
dialog's submission path. Those flows are untouched by this change.

Screenshots: `light.png`, `dark.png`, `narrow-light.png`,
`new-task-light.png`, `no-bots-light.png`.
