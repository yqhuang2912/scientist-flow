# Base File Tree verification

Reference: https://ui.shadcn.com/docs/ai-elements/base/file-tree

Verified in the VS Code integrated Chromium browser with the production
`WorkspaceFileTree` and an isolated in-memory fixture:

- Mouse click, Enter and Space each toggle a folder exactly once.
- The disclosure icon follows controlled expanded state.
- Opening the docs menu leaves the selected src row and toggle count intact.
- Its New folder action reports `create: docs`; the right-click New file action
  reports `create-file: docs`. Neither action changes the toggle count.
- The keyboard focus ring is visible and menus are keyboard accessible.
- Empty folders show no placeholder; nested files use monochrome icons and
  16 px indentation without guide lines.
- Long names truncate in the 256 px fixture; the full name remains in its title.
- Read-error feedback and Retry work; pending operations disable menu actions.
- The real task page displays the new tree and its existing expanded branches.

`workspace.png` shows the actual task page; `narrow.png` shows the isolated
fixture. No files were created/deleted and no model calls were made. The
temporary fixture route and browser tab were removed after verification.

Scoped ESLint, TypeScript and the four existing workspace-tree state tests pass.
The production build passes. It retains the pre-existing Turbopack warning
about dynamic filesystem tracing in `lib/workspace.server.ts:283`.
