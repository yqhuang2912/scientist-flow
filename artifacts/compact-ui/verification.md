# Compact UI review — 2026-11-17

## Scope

Unified shared menu/option density, icon sizing, dialog spacing and form controls.
Applied the same scale to the existing Settings, bot/group dialogs and Workspace.
Workspace now indents the complete hover surface, draws hierarchy guides and uses
semantic file-type icon accents. New file/folder copy is limited to title,
location, name and actions. Existing filesystem actions were not changed.

The working tree already contained unrelated and earlier UI changes. Those were
preserved. No commit, push, dependency update, deployment or database change.

## Checks

- Scoped ESLint: passed for the changed UI components and mobile hook.
- `node --import tsx --test tests/workspace-tree.test.ts tests/workspace-layout.test.ts`:
  9 tests passed.
- `npm run typecheck`: blocked by 19 existing errors, all in
  `components/ai-elements/`. No errors in this round's changed components.
- `npm run build`: compiled successfully; full build then failed at the same
  TypeScript errors. Existing dynamic filesystem tracing warning remains in
  `lib/workspace.server.ts`.
- `git diff --check`: passed.

## Actual Chrome review

- Desktop: opened Settings and both panes; checked spacing, control and icon scale.
- Expanded `docs`, selected its existing child, and verified that the row
  background includes the trailing menu and starts at the nested indentation.
- Opened the file dropdown and folder context menu. The parent stayed expanded;
  menus shared density and destructive styling.
- Opened folder creation from the row menu and root toolbar. Verified parent
  identity, automatic input focus, keyboard opening, Enter validation and cancel.
- Submitted an empty name: “请输入名称。” appeared; no filesystem mutation.
- Checked the final concise creation dialog in light and dark themes.
- At a 390 × 844 emulated viewport, checked full-width Workspace, visible row
  actions and the concise creation dialog with both action buttons in view.
- Corrected the mobile hook to read the same media query it subscribes to,
  avoiding an inconsistent breakpoint during viewport transitions. Verified
  entering mobile Workspace and returning to the desktop layout.
- Restored desktop mode and light theme, cancelled the dialog. No files or
  folders were created/deleted during browser review, and no chat messages sent.

Not re-tested in this styling round: every data mutation/server boundary,
physical touch devices, every generic UI component not currently mounted by
the app, or live model streaming. Mobile Settings was reviewed in code, not
through a separate mobile browser interaction.

## Screenshots

- `workspace-light.png`: nested selection and full row action alignment.
- `settings-light.png`: compact Settings reference.
- `create-folder-light.png`: final concise desktop creation dialog.
- `create-folder-dark.png`: final dark creation dialog with required-name error.
- `workspace-narrow.png`: 390px Workspace.
- `create-folder-narrow.png`: final concise 390px creation dialog.
