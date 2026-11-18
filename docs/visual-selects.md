# Select trigger / menu visual pass

2026-11-18. Adopts ClawsGo reference 09–10 after the
[Input / Field pass](./visual-inputs.md). Only the shared Select and its existing
Settings > General theme control change. Options, selection state, theme
persistence, positioning and application behavior remain intact.

## Evidence and mapping

Reference directory:
`C:/Users/tsmot/Documents/Codex/2026-11-15/ni-s/research/clawsgo-design-full/visual-system/`.
Read DESIGN, COMPONENTS, COMPONENT_VALUES, SOURCE_MANIFEST and the 09–10
source/resolved/computed/state files. Captured values are light theme at
2560 × 1063, DPR 1; declarations alone do not establish rendered states.
Composition follows the existing
[shadcn Base Select](https://ui.shadcn.com/docs/components/base/select) and
[Base UI API](https://base-ui.com/react/components/select.md).

| Current component | Reference | Change |
| --- | --- | --- |
| SelectTrigger | 09: skills-default #54, settings-general #36 / #44 | `components/ui/select.tsx`: control type, geometry, surface and focus |
| SelectContent | 10: select-popup #0 | Same file: inset, surface, shadow, viewport/anchor constraints |
| SelectGroup / SelectItem | 10: list #1, items #2 / #6 / #8 | Remove older compact-list overrides; apply measured option roles |
| Theme selector | 09: settings-general #36 | `components/general-settings-panel.tsx`: use default surface, retain its 112px width |

## Adopted values

Values use existing spacing/radius/type tokens, at a 16px root.

- Trigger: default height 32px; source-declared small height 28px; 14/20/500
  (`type-control`); 8px vertical / 12px horizontal padding; 6px gap;
  18px radius; 1px transparent border; `bg-input/50`; no resting shadow.
  Keep the existing Lucide chevron and 16px muted icon size.
- Trigger focus-visible: ring-token border plus a 3px ring at 30% ring color.
  Shadow transition is 200ms with the existing standard timing function.
  Reduced-motion disables it as a local accessibility adaptation.
  Disabled opacity remains .5; placeholder remains muted; invalid destructive
  border/ring and source dark invalid branches remain supported.
- Popup: 4px padding, 18px radius, `bg-popover/70`. The inherited-radius
  pseudo-element supplies 40px backdrop blur and saturation 150%, as declared
  in the source. `shadow-lg` is 0 10px 15px -3px and 0 4px 6px -4px, both black
  at 10%; the 1px foreground ring is 5% in light and 10% in dark.
- Popup width: minimum is the anchor width; maximum width/height come from
  Base UI's available viewport variables. Removed the old fixed 144px minimum
  and forced anchor width. The reference's sampled 128px width and 104px
  height are not generic constants. Content determines the popup's size.
- Popup animation: none, matching the captured menu's explicit override of
  its generic animation classes. `side`, offsets and `alignItemWithTrigger`
  still go to Base UI; the existing Theme menu remains below/right-aligned.
- Options: 14/20/500; min-height 28px; 6px vertical padding produces a natural
  32px single-line row; 8px left / 32px right padding; 8px gap; 14px radius.
  No inter-row gap and no second padding layer on SelectGroup. ItemText keeps
  its existing whitespace behavior and gains explicit vertical centering.
- Highlight/focus uses `highlight` with `accent-foreground`, matching the
  effective source wrapper rules. Selection remains a separate trailing
  16px checkmark, inset 8px. Select separators use foreground at 5% as declared.

## Compatibility and limits

- `secondary` remains an available trigger palette for compatibility; the only
  current call site now uses the source-backed default. No secondary sample
  establishes visual parity for that variant.
- Group labels and overflow scroll-arrow styling stay as before: reference
  09–10 does not establish a rendered label/long-list sample. No other menu
  family, Combobox, native select or navigation component is bulk-restyled.
- The existing Base UI keyboard, selection, disabled and ARIA behavior is
  retained. No new form, options, route, dependency or persistent UI state is
  introduced. No tests simply duplicate these reversible class changes.

## Validation

- Scoped ESLint, `npm run typecheck`, `npm run build`, and `git diff --check`
  passed. Build retains the pre-existing dynamic filesystem tracing warning
  at `lib/workspace.server.ts:283`.
- Native Chrome: checked the existing Settings > General control in Light
  and Dark. Browser computed trigger type is 14/20/500, padding 8/12px, gap
  6px, radius 18px, transition box-shadow / 200ms and input color at 50%.
  The existing 110% zoom snaps 32px to 31.9886 CSS px and the icon to about
  15.9943px; the source dimensions remain 32px and 16px.
- Light popup computes to approximately 112 × 104px for the three current
  options, with 4px inset, 18px radius, popover at 70%, the specified two
  shadows and 1px/5% ring. Its pseudo-element computes to
  `blur(40px) saturate(1.5)`; animation name is `none`.
- Options compute to 14/20/500, 6/32/6/8px padding, 8px gap, 14px radius and
  approximately 32px height. The group adds no padding or row gap.
- Keyboard Enter opens, Home/arrow keys move the highlight, Escape cancels
  without changing the selected Dark value and restores visible trigger
  focus. Arrow + Enter selects Light. Pointer selection of System works;
  reopening shows its checkmark. Restored the original Dark preference.
- At 390 × 700, document scroll width stays 390px. Trigger and popup remain
  between x=246 and x=358; popup bounds y=404.5–508.5 are inside the viewport.
  Trigger is 32px high; the menu's content yields 104px. No narrow-screen
  overflow was observed in this existing settings dialog.
- Disabled/invalid/small/secondary variants, long-list scrolling, grouped
  labels/separators, reduced-motion and other OS browsers were not exercised.
  Their source declarations/compatibility are not reported as browser passes.
  Reference dark rendering remains unverified. Existing extension listener
  errors were visible before interaction, so this is not a clean-console claim.
- No task, message or workspace file was created/modified; chat and document
  drafts were not edited. Closed test panels and restored the desktop viewport.

The subsequent user-authorised sequential rollout covers references 11–35;
see [the rollout ledger](./visual-rollout.md) for implementation and verification.
