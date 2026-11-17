# Input / Field visual pass

2026-11-18. Follows [Button / IconButton](./visual-buttons.md). This pass only
adopts form input surfaces and text roles. It retains the current layout,
validation, submissions, database, chat state and document editor.

## Evidence and mapping

Source directory:
`C:/Users/tsmot/Documents/Codex/2026-11-15/ni-s/research/clawsgo-design-full/visual-system/`.
Read DESIGN, COMPONENTS, COMPONENT_VALUES and the source/resolved/computed/state
files for 05–08. Values are mapped to existing foundation tokens and Base UI
components; no reference stylesheet or new theme is imported.

| Current component | Reference | File / decision |
| --- | --- | --- |
| Input | 05, subagent-form #7 | `components/ui/input.tsx`: height, typography, surface, focus |
| Textarea | 07, subagent-form #11 / #15 | `components/ui/textarea.tsx`: form typography/surface; preserve content sizing |
| Label, FieldLabel | 08, label child nodes #6 / #10 / #14 / #17 / #23 | `components/ui/label.tsx`, `components/ui/field.tsx`: label role |
| FieldDescription | 08, auxiliary P nodes #8 / #12 / #21 / #25 / #28 | `components/ui/field.tsx`: auxiliary text role |
| InputGroup, InputGroupInput | 06, skills-default and skills-search-focused | `components/ui/input-group.tsx`: default surface; wrapper owns focus ring |
| Workspace create/delete fields | Same roles, no reference business logic | `components/workspace-folder-dialogs.tsx`: remove two 13px label and one 11px helper overrides |

The source snapshots are light theme at 2560 × 1063, DPR 1. The 06 search
group includes an actual focused snapshot with a 3px ring at 30%. Other
focus, disabled, invalid and dark branches are source declarations unless
explicitly identified as a rendered sample. Source evidence is not the same
as local browser validation.

## Adopted values

All lengths retain the existing spacing/radius formulas at a 16px root.
Widths remain responsive; measured 528px form / 224px search widths are not
global constants.

| Role | Font / line-height / weight | Geometry |
| --- | --- | --- |
| Desktop Input | 14 / 20 / 500, `type-control` | 32px height; 4px vertical / 10px horizontal inset |
| Desktop form Textarea | 13 / 18.5714 / 500, `type-control-compact` | 64px base minimum; 8px vertical / 10px horizontal inset |
| Label | 14 / 19.25 / 500, `type-field-label` | Existing 8px content gap; field gap remains 6px |
| Helper | 12 / 16 / 400, `type-meta` | Existing contextual margins/wrapping retained |
| Error | 14 / 20 / 400 | Existing destructive role and alert semantics retained |

- Form surface: `bg-input/50`; 1px transparent resting border; radius 18px
  (`rounded-2xl` = 1.8 × root radius); no resting shadow.
- Focus-visible: ring-token border and 3px ring at 30% ring color. InputGroup
  uses the focused child selector and keeps its embedded control ring at zero.
- Invalid: destructive border, 3px ring at 20%; source dark border at 50% and
  ring at 40%. Keep `data-invalid`, `aria-invalid`, error associations and
  react-hook-form behavior.
- Disabled standalone controls: opacity .5; existing cursor/pointer behavior
  retained. Remove the private disabled background overrides so surface color
  continues to derive from input/50.
- Transition: color and box-shadow, 200ms, cubic-bezier(.4, 0, .2, 1).
  Reduced-motion disables this transition as a local accessibility adaptation.
- Default InputGroup adopts the same 32px/18px surface and 14/20/500 addon type.
  Existing add-on padding and leading/trailing control adjustments remain.

## Intentional differences and deferred work

- Below the existing `md` breakpoint, standalone form input text remains 16px
  to retain the project's mobile input zoom precaution. Its role line-height
  ratio yields 22.8571px. Desktop captures do not establish a mobile reference;
  real iOS keyboard/zoom behavior was not verified.
- Textarea retains `field-sizing: content` and its existing 64px minimum;
  Bot form retains its 96px minimum and resize policy. The reference uses
  contextual fixed 64px / 160px heights; these are not forced on every form.
- `Textarea variant="document"` is unchanged. InputGroup's `muted` composer
  variant retains its surface/focus geometry, and its small textarea remains
  13/20/400 at both widths. No chat or editor state logic is modified.
- FieldTitle and label-style FieldLegend adopt the label role semantically;
  they are not separate measured reference samples. FieldSet/FieldGroup
  spacing, FieldContent, label-card composition and error sizing are retained.
  No rendered reference error-text sample was available.
- Command search retains its existing local size/surface overrides until
  reference 31 is addressed. Select, Combobox and their menus remain separate
  component passes; this does not claim a complete reference search redesign.
- InputGroupButton retains the completed button pass. No component is replaced
  from a registry, and no dependency is installed or upgraded.

## Validation

- Scoped ESLint, `npm run typecheck`, `npm run build` and `git diff --check`
  passed. Build retains the pre-existing dynamic filesystem tracing warning
  at `lib/workspace.server.ts:283`.
- Existing New task dialog, dark theme: browser computed values match Input,
  Label, Helper and Error roles above. Empty submission is rejected by client
  validation; Chinese/English entry clears the name error. The invalid input
  computes to a 3px destructive ring at 40% and border at 50% in dark mode.
- Existing New bot form, light theme: multiline Chinese/English text wraps;
  textarea computes to 13/18.5714/500, 18px radius, 8px/10px padding,
  input/50 background, 200ms color/box-shadow transition and content sizing.
  Its existing 96px minimum is retained. Visible keyboard focus is preserved.
- At 390 × 700, the New task input computes to 16/22.8571, 32px height and is
  contained. Document scroll width is 390px; errors remain in the dialog.
  Composer text still computes to 13px on this viewport and 13/20/400 desktop.
- The New bot textarea at 390 × 700 computes to 16/22.8571 and grows with the
  test content to 155.062px. Its bounds and the document scroll width remain
  within 390px; that measured content height is not stored as a fixed size.
- Browser zoom remains the existing 110%; 32px and 96px sometimes measure
  31.9886px / 95.9943px due to device-pixel snapping. Source formulas are intact.
- Disabled/pending requests, every InputGroup configuration, file-picker and
  reduced-motion states were not all exercised. Declarations and compilation
  are not reported as runtime passes. Dark reference pixel parity is unverified.
- One browser listener/message-channel error also appears outside form actions;
  no claim of a clean extension/browser console is made. No new tasks, bots,
  messages or files were saved during this visual check. Temporary form text
  is discarded; existing chat/document drafts are not edited.
- No new tests mirror this reversible styling implementation. Checks cover the
  changed components and selected pages, not the entire application.

Next suggested independent pass: Select trigger / menu (reference 09–10).
Do not continue automatically.
