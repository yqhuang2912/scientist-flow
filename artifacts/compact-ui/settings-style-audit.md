# Settings item style audit

Reference: the user-selected Bots / Workspace navigation in Settings.

The repository inventory contains 130 component modules; 49 are reachable from
the current application routes/layouts. The audit traced these imports and
reviewed the navigation, list, menu, form, popup, and icon styles, including
shared primitives used by currently inactive components.

## Changes

- Shared item typography: Inter, 13 px, 20 px line height, weight 500.
- Shared item geometry: 30 px minimum height, 10 px horizontal inset, 8 px
  icon-to-text gap, 2 px between rows, existing `rounded-xl` token.
- Navigation, menus, option lists, search results, file rows and bot choices
  now use the same density. Active selection uses the Settings muted surface;
  hover/menu highlight uses the existing highlight token.
- Small identity avatars use the same 16 px column as Lucide icons. Sidebar
  message previews align under the name rather than adding a second indent.
- File names and trailing menu buttons retain a single row highlight. Recursive
  lists retain their hierarchy and now have consistent row spacing.
- Bot checkboxes align on the trailing edge. Their expanded hit area is bounded
  by the clickable row, preventing a horizontal scrollbar.
- Select options are grouped correctly, with consistent popup inset and spacing.
- Popover/hover-card surfaces, tabs, toggles, generic navigation, accordion
  triggers and the reusable AI file tree follow the same control scale.
- Body text, code, conversation avatars and large bot portraits retain their
  readable content scale. Destructive colors and keyboard focus remain distinct.

The reusable rules and dimensions are in `docs/interface-style.md` and
`components/ui/compact-styles.ts`. No database, filesystem operation, chat
session lifecycle, dependency, or background-task logic was changed in this pass.

## Verification

| Check | Result |
| --- | --- |
| Scoped ESLint | No errors; one existing unused `_id` warning in prompt-input |
| Tree and responsive-layout tests | 9 passed |
| Typecheck | 19 existing AI Elements errors; no new errors |
| Production build | Compiled successfully; blocked during TypeScript by those existing errors; existing workspace fs tracing warning remains |
| Settings and sidebar | Inspected in the real Chrome page |
| Search | Keyboard selection uses the common row highlight and spacing |
| Workspace tree/menu | Expanded child remains visible after opening its parent's menu; whole-row highlight aligns with the trailing control |
| Folder creation dialog | Inspected and cancelled without creating anything |
| Bot multi-select | Selected row and keyboard focus verified; cancelled without creating a chat |
| Composer bot menu | Grouped options, icon/text alignment and selected checkmark verified; original selection retained |
| Dark theme | Selected, hovered and keyboard-focused rows inspected |
| 390 × 844 viewport | Dialog fits; list has no horizontal scrollbar; footer controls remain visible |

The currently unused components were statically checked, not mounted in a new
test gallery. No real create/delete/save action or model request was initiated
for these style checks. Browser emulation and theme were restored afterwards.

## Screenshots

- [Desktop](./unified-desktop.png)
- [Workspace and menu](./unified-workspace-menu.png)
- [Search](./unified-search.png)
- [Bot selection](./unified-bot-selection.png)
- [Dark theme](./unified-bot-selection-dark.png)
- [390 px layout](./unified-mobile.png)
- [Composer bot menu](./unified-bot-menu.png)
