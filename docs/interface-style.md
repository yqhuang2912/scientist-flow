# Compact application UI

The 2026-11-18 [visual foundation](./visual-foundation.md) supersedes this
document's font/token guidance. Its ClawsGo component index governs subsequent
visual passes. [Button / IconButton](./visual-buttons.md) now supersedes the
button metrics below. [Input / Field](./visual-inputs.md) supersedes form input
surfaces and field typography. Other geometry below describes the existing implementation,
not components already migrated to the new reference.

[Select trigger / menu](./visual-selects.md) now governs the shared Select
family and the Settings theme selector (reference 09–10).

[Sequential visual rollout](./visual-rollout.md) supersedes the remaining legacy
metrics below for references 11–35. It records each family's current values,
application adaptations, browser coverage and screenshots. Menus, navigation,
tabs, chat and document text deliberately have different roles/densities;
`compact-styles.ts` is no longer a universal source for all these families.

Settings navigation — specifically the Bots and Workspace items — is the density
reference. Keep the current Inter
typeface, neutral light/dark themes, Lucide icons, and Base UI shadcn primitives.
Do not add a second theme or change chat behavior for visual consistency.

## Shared scale

| Element | Scale |
| --- | --- |
| Menu, navigation | 30 px minimum height; 13 px / 20 px text; weight 500 |
| Row inset / icon-to-label gap | 10 px horizontal / 8 px |
| Adjacent items | 2 px gap; file-tree levels use the official gapless stack |
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
and navigation states. Settings, sidebar, bot selection, generic
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
Expanded sidebar items use a 6 px left inset, placing icons and portraits 4 px
closer to the left edge; collapsed items stay centered. The header uses the
shared sidebar trigger with the standard foreground and circular ghost
button surface. Search's keyboard hint uses plain muted `Kbd` text with no keycap
background or border. Recents and chat search
show absolute activity times: `HH:mm` today, `MMM d` on other dates this year,
and `yyyy-MM-dd` in other years. Hover reveals the full date, time and UTC offset.
The bot editor keeps its larger 40 px avatar preview.
Readable message text, code, and full-size bot portraits keep their own content
scale. Secondary descriptions use 12 px normal-weight
text; metadata uses 11 px. Multiline rows may grow rather than clipping content.
Bot names in the chat header, task picker and chat search use `BotName`: the job
follows the name on the same baseline in muted 12 px text. Keep the row height,
truncate long descriptions, and expose the full identity on hover. Task titles
remain task titles; they do not inherit a member bot's job.

Chat messages use a 28 px avatar on both sides: the responding bot on the left,
and a neutral default user avatar on the right. Direct chats use their bot's
avatar too. Each message has a separate 28 px identity line containing its
avatar, followed by the body with an 8 px gap. The body spans the identity
line's full width: its outer edge aligns with the avatar, not the name column.
Assistant body content has a 4 px optical inset to match the visible avatar
and copy glyphs inside their containers.
Bot names use 14 px medium text
and their job uses the shared muted 12 px `BotName` treatment. Assistant Markdown
uses `type-chat-response` (15/26 px, regular); user Markdown uses
`type-chat-prompt` (14/22 px, medium). Keep normal letter/word spacing and
Streamdown's 16 px block spacing. See [chat typography](./visual-chat-markdown.md).
User messages
show only `You` in that line until a user profile is available. Keep user
identity right-aligned and bot identity left-aligned with their content column.
Addressed bots appear inline as muted `@Name` text, without a
portrait, badge border or background. Leave 10 px before the message body.
The mention and first paragraph share inline text flow, so wrapped lines
return to the mention's left edge instead of retaining a mention-width indent.

Chat presentation composes the official shadcn AI Elements primitives:
`MessageScroller` owns following/anchoring/jump-to-latest, `Message` owns the
identity row, and `Bubble` owns the user surface. The assistant answer sits
directly in `MessageContent`, with clipboard actions in `MessageFooter`. Consecutive reasoning,
tool and source parts form one compact `Trace`; text, files, step boundaries
and approval requests split that run. Preserve the stream's original order.
Reasoning opens while streaming and closes when finished unless the reader
explicitly toggles it. Tool results are collapsed; errors open for inspection.
Approvals use a separate review surface with Deny / Approve actions. Render
only events supplied by the backend; do not invent thoughts or progress steps.
Markdown, code, math and Mermaid share the existing Streamdown renderer, with
its Tailwind sources and KaTeX stylesheet loaded in `app/globals.css`.
Chat code uses the shared system monospace stack at its existing size. Follow the official
Base Message example: a muted rounded surface, language label, line numbers
and copy button, with no separate tinted toolbar. Markdown fences and tool
values share `components/ui/code-block.tsx`. `ChatMarkdown` handles highlighting;
Mermaid keeps its installed renderer and matches the code surface. Its 13 px
labels follow live theme tokens, including in fullscreen.
See [chat presentation](./chat-presentation.md) for the runtime boundary.

The composer uses the shadcn `InputGroup` composer variant, a multiline
textarea, a grouped `Command` menu for @mentions and a circular
send/stop control. The textarea uses 13 px / 20 px typography with 12 px insets
and grows to 192 px before scrolling. Only a disabled text control can dim the
group. Preserve IME composition, newline entry, pending state and newer drafts.
Do not restore the removed AI Elements wrappers or a second chat theme.

The neutral light palette is approximately white `#ffffff`, ink `#0a0a0a`,
muted surface `#f5f5f5`, secondary text `#737373`, and border `#e5e5e5`.
Use semantic Tailwind tokens in components; dark mode uses the corresponding
theme values. File type accents are the six `file-*` semantic tokens in
`app/globals.css`; color supplements the icon shape and filename.

## Workspace alignment

Follow the official [Base File Tree](https://ui.shadcn.com/docs/ai-elements/base/file-tree)
composition: folders are controlled `Collapsible` components with
`CollapsibleTrigger render={<Button variant="ghost" size="sm" />}`, and files
are ordinary ghost Buttons. Use the example's normal text weight, monochrome
`FolderIcon` / `FileIcon`, and a 16 px (`ml-4`) child indentation. Do not add
colored extension/zone icons, guide lines, a file disclosure spacer, custom row
geometry or a separate file-tree theme.

The main button covers the row surface; the trailing menu is a sibling control
positioned at the right edge, never a nested button. Preserve selection with
`aria-current`, while the Collapsible trigger owns expanded state and keyboard
activation. The root is a labelled group of disclosure buttons, not an ARIA
tree without its required arrow-key navigation. Long names truncate with a title.

Menu actions remain available on touch devices and keyboard focus. Menus never
toggle a directory. Preserve row-wide hover, standard focus rings, controlled
expansion, lazy reads, retries, truncation notices and row-bound operation targets.
Expanded empty directories render no placeholder.

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
