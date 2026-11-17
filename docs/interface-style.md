# Compact application UI

Settings navigation — specifically the Bots and Workspace items — is the density
reference. Keep the current Inter
typeface, neutral light/dark themes, Lucide icons, and Base UI shadcn primitives.
Do not add a second theme or change chat behavior for visual consistency.

## Shared scale

| Element | Scale |
| --- | --- |
| Menu, navigation, file row | 30 px minimum height; 13 px / 20 px text; weight 500 |
| Row inset / icon-to-label gap | 10 px horizontal / 8 px |
| Adjacent items | 2 px gap, including recursive file-tree levels |
| Action icon | 16 px; Lucide's default 2 px stroke |
| Small row action | 24 px target; 16 px icon |
| Standalone icon button | Square target with `rounded-full` in hover, selected, pressed and focus states |
| Item radius | `rounded-xl` (14 px with the current root radius) |
| Popup menu | `rounded-2xl` (18 px); 6 px inset |
| Dialog | `rounded-3xl` (22 px); 16 px content inset |
| Dialog title / description | 15 px / 13 px |
| Dialog footer | 16 px horizontal, 12 px vertical inset |
| Supporting form text | 12 px |

`components/ui/compact-styles.ts` owns row typography, geometry, list spacing,
and navigation states. Settings, sidebar, file tree, bot selection, generic
items, dropdown, context, menubar, select, combobox and command items use it.
Buttons share the typography. Keep their native
selection, disabled, focus and destructive states. Do not override spacing at
individual call sites unless the content has a different structural need.

`iconButtonStyles` owns circular icon-button geometry. Use an `icon*` Button
size (also forwarded by InputGroupButton) for icon-only actions. Collapsed
sidebar items and small sidebar actions are circular too. Text buttons, expanded
navigation rows and connected segmented controls retain their own shapes.

Hover and keyboard menu highlighting use `bg-highlight`; persistent selection
uses `bg-muted`, as in Settings. Preserve keyboard focus rings and destructive
menu colors. A file row's name and trailing menu share the same highlight.
Bot and group-chat avatars use 28 px, matching assistant-message avatars, in
the sidebar, chat header, search, Settings, selection lists and message badges.
`chatAvatarStyles` owns that scale; `compactChatAvatarStyles` lets the portrait
occupy a 20 px content line using 4 px negative vertical margins. This keeps
single-line items at 30 px including their original padding. Multiline items
still grow for text. Center avatars in the collapsed 32 px action target.
Bot portraits are not navigation icons and must not inherit their 16 px size.
The bot editor keeps its larger 40 px avatar preview.
Readable message text, code, and full-size bot portraits keep their own content
scale. Secondary descriptions use 12 px normal-weight
text; metadata uses 11 px. Multiline rows may grow rather than clipping content.

The neutral light palette is approximately white `#ffffff`, ink `#0a0a0a`,
muted surface `#f5f5f5`, secondary text `#737373`, and border `#e5e5e5`.
Use semantic Tailwind tokens in components; dark mode uses the corresponding
theme values. File type accents are the six `file-*` semantic tokens in
`app/globals.css`; color supplements the icon shape and filename.

## Workspace alignment

```text
v [folder] docs                         […]
  │ [text] notes.md                     […]
  │ > [folder] references               […]
  │   │ [text] sources.bib              […]
  [code] analysis.py                    […]
```

Each recursive list indents the whole row by 21 px and draws a thin guide at its
parent icon's center. The disclosure gutter sits outside the hover surface.
The file/folder icon, name and trailing action share one rounded row background.
The main click area and action menu button are siblings. Root-level files and
folders have the same icon/text columns; trailing menus align at the right edge.
Long names truncate with a title; full paths in operation dialogs wrap.

The menu action remains accessible on touch devices and on keyboard focus.
Opening a menu never toggles a directory. Selected, hovered and menu-open rows
use the same subtle foreground overlay; a visible keyboard focus ring remains.

## Dialogs

Use the common Dialog/AlertDialog typography and footer. A dialog with `p-0`
must give its footer `mx-0 mb-0`; avoid carrying the default negative margins
into an edge-to-edge layout. Form bodies can scroll independently on short
viewports. Keep destructive confirmation text and cancel-first focus intact.
Settings switches from a left navigation column to a top row on small screens.
General is the default section and currently contains only Theme (Light, Dark,
System). It uses the existing theme provider and saved browser preference. Keep
the selector at the shared 30 px control height with a muted secondary surface;
small-screen navigation wraps instead of stretching or overflowing the dialog.

The New task flow uses Task terminology for creation, editing, validation and
deletion. Its compact dialog has a 16 px task icon, Task name, Bots, and
Cancel / Create task; avoid a second introductory paragraph. Bot choices keep
30 px rows and the shared 28 px portraits. Task actions reuse the existing
named multi-bot conversation and workspace identity; `group` remains an internal
storage/runtime discriminator, not a user-facing product concept.

Creation dialogs use “New file” / “New folder”, “Name”, and “Cancel / Create”.
A plain 16 px Lucide file/folder icon precedes the title. The destination uses
task-relative notation (`root: /`, `root: docs/`) below the title as muted 12 px
text, aligned with the icon's left edge. It wraps when needed and follows the
target captured when the dialog opens. Do not show the absolute workspace path
or add a location row or path pill.
A short placeholder gives one example; validation errors appear on demand.

The root-directory settings header puts the full current path below its title,
in smaller muted text, followed by a full-width hint. Show the proposed path
only in its input. Use one inline error for a nonempty destination and center
the submit button. Both first-time selection and migration require an existing
empty destination; recheck on the server before writing or moving directories.

References: user-supplied ClawsGO screenshots and
[shadcn Base UI components](https://ui.shadcn.com/docs/components/base/dialog).
