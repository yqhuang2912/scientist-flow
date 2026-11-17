# Button / IconButton visual pass

2026-11-18. This is the second independent visual pass, after
[visual-foundation.md](./visual-foundation.md). Only the shared button family
and the wrappers needed to adopt it are changed. Navigation, dialogs' layout,
inputs, editor, task execution and application data remain outside this pass.

## Evidence and mapping

Reference directory:
`C:/Users/tsmot/Documents/Codex/2026-11-15/ni-s/research/clawsgo-design-full/visual-system/`.
Use COMPONENTS / COMPONENT_VALUES and component 01–04 source, resolved,
computed and state files. These are light-theme measurements; hover/focus,
invalid and dark declarations are not proof of captured reference states.
API composition remains the project's existing
[shadcn Base UI Button](https://ui.shadcn.com/docs/components/base/button) and
[InputGroupButton](https://ui.shadcn.com/docs/components/base/input-group).

| Current component | Reference | Change / file |
| --- | --- | --- |
| Default, outline Button | 01–02, skills-default #51 / #49 | 32px, standard control type; `components/ui/button.tsx` |
| Small Button | 03, subagent-form #30 / #31 | 28px, standard control type; same file |
| Compact Button | 03, subagent-form #26 | 28px, compact control type; same file |
| Toolbar / composer icons | 04, chat-default #14 / #951 / #959 / #963 / #986 | 30px circular targets, no transition; same file |
| Dialog close | 04, subagent-form #32 | Opt into 28px `icon-compact`; `components/ui/dialog.tsx` |
| InputGroupButton | 03–04 | Forward `sm` to compact; remove duplicated geometry/type overrides; `components/ui/input-group.tsx` |
| Existing tree row | Deferred 27 | Explicit compatibility `row` size; `components/workspace-file-tree.tsx` |

## Adopted values

Lengths derive from the existing 4px spacing and 10px radius tokens, at a 16px
root. Button widths remain content-driven. No measured text width is fixed.

| Size | Height | Font / line-height / weight | Horizontal inset | Gap |
| --- | --- | --- | --- | --- |
| default | 32px | 14 / 20 / 500 (`type-control`) | 12px; icon side 10px | 6px |
| sm | 28px | 14 / 20 / 500 (`type-control`) | 12px; icon side 8px | 4px |
| compact | 28px | 13 / 18.5714 / 500 (`type-control-compact`) | 10px; icon side 8px | 4px |
| icon, existing icon-sm alias | 30 × 30px | Standard control type | 0 | normal |
| icon-compact (dialog close) | 28 × 28px | Standard control type | 0 | normal |

- Text-button radius: `rounded-2xl`, 1.8 × root radius = 18px. Existing
  connected ButtonGroup end geometry remains owned by ButtonGroup.
- Icon targets: `rounded-full`, preserving ScientistFlow's explicit circular
  hover/selected/focus requirement. Reference radii of 18px and 25.2px exceed
  half their square targets and produce circles too; the latter comes from a
  local radius override, not a new global token.
- Borders: 1px, transparent unless the variant/state supplies a semantic color.
  Resting shadow: none. Icons default to 16px without overriding explicitly
  sized icons. Keep data-icon side-specific padding.
- Standard transitions: all, 150ms, existing cubic-bezier(.4, 0, .2, 1).
  Toolbar icons: none / 0ms. Dialog close retains the standard transition.
  Reduced-motion continues to disable transitions.
- Focus-visible: ring token border; 3px outer ring at 30% ring color.
- Disabled: opacity .5 and pointer-events none, retaining Base UI behavior.
- Primary: existing primary / primary-foreground; hover primary at 80%.
- Outline: border / background / foreground; muted hover and expanded state.
  Source dark rules use transparent resting background and input at 30% hover.
- Invalid: destructive border and 3px destructive ring at 20%; source dark
  border at 50%, ring at 40%. No new validation behavior is added.

## Deliberate limits and compatibility

- The 30px `icon-sm` alias is retained because existing toolbar callers use it.
  Dialog close explicitly selects the new 28px size. Other close controls have
  not been bulk-restyled.
- `row` preserves the file tree's 30px height, 13/20 type, 10px inset and 8px
  gap. It is a compatibility size, not a newly measured reference Button.
  The tree's existing normal weight and trailing-menu inset still apply.
- `xs` (24px), `lg` (36px), and `icon-lg` (36px) retain existing metrics; they
  are not presented as verified 01–04 measurements. The existing 24px row
  action target remains. InputGroup's xs keeps its existing 13/20 type/inset,
  but now inherits the shared button radius instead of its private 7px rule.
- Ghost retains the existing highlight token used by the reference composer
  icon samples and ScientistFlow. The reference also has muted toolbar ghost
  variants; this pass does not claim all contextual variants are identical.
- Secondary, destructive and link palettes retain current ScientistFlow
  behavior; references 01–04 do not establish their full state matrices.
- Input/Select heights and menu/navigation typography are deferred to their
  own component passes. No global 13px-to-14px replacement was performed.

## Validation

- Scoped ESLint, `npm run typecheck`, `npm run build`, and `git diff --check`
  passed. Build retains the existing dynamic filesystem tracing warning at
  `lib/workspace.server.ts:283`.
- Native Chrome, existing New task, Settings > Bots, chat composer and Test
  workspace: computed heights/type/insets/gaps match the table. At the existing
  110% browser zoom, 28/32px sometimes measure 27.9972/31.9886 CSS px; the 1px
  border snaps to 0.909091 CSS px. Source formulas remain 28/32px and 1px.
- Default New task action computes to 14/20/500, 12px inset, 6px gap, 18px
  radius and no resting shadow. Settings Manage bots computes to 28px,
  14/20/500, 12px inset and 4px gap.
- Composer bot selector computes to 28px, 13/18.5714/500 and 4px gap; disabled
  send is 30px, opacity .5 and transition none / 0ms. File rows retain 30px,
  13/20 and 8px gap, including their existing trailing-action space.
- Keyboard Shift+Tab reaches the circular 28px dialog close button and shows
  a visible focus ring. Workspace toggle shows a circular active/hover surface.
- Checked light and dark locally. Dark reference rendering was not captured,
  so local usability checks do not establish reference pixel parity. Invalid,
  destructive, reduced-motion and every contextual hover state were not all
  triggered in the browser; their declarations are retained/compiled only.
- At a 390 × 700 CSS-pixel viewport, Settings > Bots remains contained:
  document scroll width is 390px, and every dialog button is within the viewport.
  Manage bots and Close both retain their 28px heights. This is a focused
  responsive smoke check, not verification of every page or ButtonGroup.
- No tasks/messages submitted, no files created/deleted, and no drafts edited.
  No new tests mirror this reversible styling implementation.

The subsequent [Input / Field pass](./visual-inputs.md) adopts 05–08. Its changes
are separate from this button pass.
