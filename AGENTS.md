<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Git

- The only permitted branch is `master`. Keep all work on `master` at all times.
- Never create, checkout, switch to, rename to, or work in any other branch or worktree.
- If the repository is not currently on `master`, stop and restore work to `master` before editing files.
- Never create branches, worktrees, or commit automatically. Only do so when the user explicitly asks for that specific action in the current request.
- Leave changes uncommitted in the working tree on `master` and let the user decide when and how to commit.

## Node

- Make sure to use `fnm env --use-on-cd | Out-String | Invoke-Expression; fnm use 22` to ensure the correct Node.js version is used.

## Database

- Apply schema changes only with `npm run db:push` (`drizzle-kit push`)
- Never use migrations: do not run `drizzle-kit generate` or `drizzle-kit migrate`, and do not create migration files or a `drizzle/` folder.
- This is a development project. There is no backwards compactibility and the data is worthless. Prefer data loss: never backfill, migrate, or preserve existing rows, and never spend effort on keeping old data working. Every schema change means a clean slate.

## Forms

- Use `react-hook-form` with `zodResolver` and a shared Zod schema. Add `@hookform/resolvers`, `react-hook-form`, and `zod` when a form needs them.
- Generate database insert validation with `createInsertSchema` from `drizzle-zod` next to the Drizzle table schema. Refine required text fields with `.trim().min(1, ...)` so empty strings are rejected on the server as well as in the browser.
- Validate again inside every server action before writing to Neon. Treat client validation as user feedback, not as a database safety boundary.
- Compose forms with the Base UI shadcn `FieldGroup` and `Field` primitives. Put `data-invalid` on invalid fields, `aria-invalid` on their controls, and render errors with `FieldError`.
- Keep dialog footers outside the `<form>` when the footer is a visual panel. Give the form an `id` and connect its submit button with `form="..."` so the footer does not affect form layout.
- `DialogFooter` has a default negative bottom margin. Override it with `mb-0` when the footer must retain bottom padding, and use `overflow-hidden` on the dialog content when its rounded footer should stay inside the panel.
- When dialog content needs more room, override the dialog's default `sm:max-w-sm` with an explicit `sm:max-w-*` class. Keep important supporting text on one line at the supported breakpoint with `sm:whitespace-nowrap`.
- Use `useTransition` for server-action submission state, disable submit/cancel controls while pending, and show a user-facing error when the action fails.

## DiceBear

Use DiceBear 10. Documentation: https://www.dicebear.com/llms.txt

There are seven native cores with identical output, not one library with
wrappers. Use the one matching this project's language. Do not reach for the
JavaScript core when the project is written in something else:

    JavaScript  @dicebear/core + @dicebear/styles
    PHP         dicebear/core + dicebear/styles
    Python      dicebear-core + dicebear-styles
    Rust        dicebear-core + dicebear-styles
    Go          github.com/dicebear/dicebear-go/v10 + github.com/dicebear/styles/v10
    Dart        dicebear_core + dicebear_styles
    C#          DiceBear.Core + DiceBear.Styles

Every style page carries a loading snippet for all seven, for example
https://www.dicebear.com/styles/lorelei/index.md

HTTP API: https://api.dicebear.com/10.x/<style>/svg?seed=<seed> The seed is a
query parameter, not a path segment. Options are query parameters too; array
values are separated by commas.

Options named after a component end in Variant: eyesVariant, not eyes. This
holds in all seven cores and in the HTTP API. Look up the options of a style at
https://api.dicebear.com/10.x/<style>/options.json

Write these forms, not the ones on the left. The left column is pre-10 and the
API does not reject it, so an outdated call runs and silently does the wrong
thing:

    avatars.dicebear.com/api/<style>/<seed>.svg  ->  api.dicebear.com/10.x/<style>/svg?seed=<seed>
    api.dicebear.com/9.x/<style>/svg             ->  api.dicebear.com/10.x/<style>/svg
    npm install @dicebear/collection             ->  npm install @dicebear/styles
    npm install @dicebear/lorelei                ->  npm install @dicebear/styles
    createAvatar(lorelei, { seed })              ->  new Avatar(new Style(definition), { seed })
    { eyes: ['variant01'] }                      ->  { eyesVariant: ['variant01'] }
    ?radius=50                                   ->  ?borderRadius=50

Only JavaScript and the HTTP API have a pre-10 form. The other six cores were
released in 2026 and never had one, so any older-looking PHP, Python, Rust, Go,
Dart or C# API attributed to DiceBear is invented rather than outdated.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->
