# Visual foundation — 2026-11-18

This pass only establishes fonts and foundation tokens. Existing layouts,
navigation, component dimensions, editor state and task behavior remain intact.
Pre-existing uncommitted component changes are retained, not attributed to this
pass. The subsequent [Button / IconButton pass](./visual-buttons.md) adopts
reference 01–04 without expanding this foundation pass's scope.

## Evidence and mapping

Reference directory supplied by the user:
`C:/Users/tsmot/Documents/Codex/2026-11-15/ni-s/research/clawsgo-design-full/visual-system/`.
Read DESIGN, COMPONENTS, COMPONENT_VALUES, FOUNDATION and SOURCE_MANIFEST, with
the source/resolved/computed/state files for typography roles listed below.
The reference computed snapshots are light theme, 2560 × 1063, DPR 1. Source
declarations alone do not establish rendered states or pixel-identical fonts.

| Current implementation | Reference | Decision in this pass |
| --- | --- | --- |
| `app/layout.tsx`, `--font-sans` | FOUNDATION, 35 | Keep self-hosted variable Inter; explicitly declare variable weight |
| `--font-mono`, code/editor consumers | FOUNDATION, 25, 30 | Use the reference system monospace stack; remove Geist Mono loading |
| Existing light `:root` semantic colors | FOUNDATION, 34 | Already match; retain values and aliases |
| Spacing and derived radius | FOUNDATION | Pin existing 4 px spacing; retain radius formulas |
| Role definitions in `app/globals.css` | 01, 03, 08, 15, 22, 23, 25, 26, 30, 35 | Define opt-in `type-*` utilities; component adoption is deferred |
| Navigation / tree local radius | 16, 17, 27 | Document exception only; no local radius changes yet |

## Fonts

Inter is loaded once by `next/font/google`, weight `variable` (100–900), normal
style, `display: swap`, Latin preload. Next serves generated font assets from
the application; there is no reference-site font hotlink. Its generated family
name is Inter, not literally “Inter Variable”; font version/build equivalence
with the reference is not claimed. Keep Next's metric-adjusted fallback.

Sans fallback after the generated Inter stack is now `sans-serif`, matching
FOUNDATION's `"Inter Variable", sans-serif` rule. The initial pass retained an
explicit CJK list; the Chinese-font follow-up below removes that list after
verifying that it selected a different face from the reference in the same
browser. Chinese still uses the browser/OS fallback, without downloading or
hotlinking a new font. Cross-platform font identity is not guaranteed.

Monospace: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
"Liberation Mono", "Courier New", monospace`. Actual glyphs depend on the OS.
Code font metrics may differ from the previously loaded Geist Mono; code sizes,
wrapping rules and editor behavior are unchanged. Existing serif fallback is
retained; no new serif font is downloaded.

## Exact foundation values

All lengths below assume the existing 16 px root; rem formulas are retained.

- Spacing: `0.25rem` (4 px); fractional steps remain valid (2, 6, 10, 14 px).
- Radius: root `0.625rem` (10 px); multipliers `.6 / .8 / 1 / 1.4 / 1.8 / 2.2 /
  2.6`, yielding 6 / 8 / 10 / 14 / 18 / 22 / 26 px. Do not flatten formulas or
  apply the reference navigation's local `--radius` globally. Full circles stay
  `rounded-full`; component-specific 24 px caps are deferred.
- Existing Tailwind size/line-height steps are pinned: xs 12/16, sm 14/20,
  base 16/24, lg 18/28, xl 20/28, 2xl 24/32, 3xl 30/36 px.
- Normal / medium / semibold / bold weights: 400 / 500 / 600 / 700.
- Fractional `leading-*` utilities derive from `--spacing` in Tailwind 4;
  redundant escaped `--leading-4.5/5.5/6.5` declarations were removed.

Light color values were already present in the working tree and are retained:

| Semantic tokens | Value |
| --- | --- |
| background, card, popover, chat-input | `oklch(1 0 0)` |
| foreground, card-foreground, popover-foreground | `oklch(.145 0 0)` |
| primary; primary-foreground | `oklch(.205 0 0)`; `oklch(.985 0 0)` |
| secondary, muted, accent, chat-status | `oklch(.97 0 0)` |
| secondary-foreground, accent-foreground | `oklch(.205 0 0)` |
| muted-foreground | `oklch(.556 0 0)` |
| border, input | `oklch(.922 0 0)` |
| ring | `oklch(.708 0 0)` |
| sidebar; sidebar-foreground | `oklch(.985 0 0)`; `oklch(.371 0 0)` |
| destructive | `oklch(.577 .245 27.325)` |
| surface | `var(--muted)` |
| highlight; sidebar-accent | foreground at 5% in oklab; `var(--highlight)` |

The reference `@supports (color: color-mix(in lab, red, red))` condition and
foreground fallback now accompany highlight. Modern supported browsers use the
same 5% light / 10% dark mix as before. Existing chart, link and chip values
also match FOUNDATION and are retained. Component opacity modifiers, border
widths, focus rings and shadows are not globally replaced in this pass.

Dark values remain the existing source-backed values, including background
`.205`, card/popover `.269`, sidebar `.25`, muted `.371`, foreground `.985`,
muted-foreground `.708`, white 10% border and white 15% input. Local `.dark`
panels and the existing theme provider remain supported. The reference's dark
theme was not captured; local checks cannot establish reference visual parity.

## Typography roles for subsequent component variants

These utilities compose the existing Tailwind/theme values; they do not create
a second theme or globally restyle headings, labels, paragraphs or editors.
None is bulk-applied to existing component call sites in this pass.

| Utility | Size / line-height / weight | Reference |
| --- | --- | --- |
| `type-control` | 14 / 20 / 500 | 01; also 22's user-message role |
| `type-control-compact` | 13 / 18.5714 / 500 | 03; line-height remains 20/14 ratio |
| `type-field-label` | 14 / 19.25 / 500 | 08 label child, not the field container |
| `type-meta` | 12 / 16 / 400 | 08 auxiliary copy |
| `type-section-title` | 16 / 24 / 500 | 35 |
| `type-dialog-title` | 16 / 16 / 500 | 15 |
| `type-page-title` | 18 / 28 / 500 | 35 |
| `type-step` | 15 / 24 / 500 | 23 |
| `type-composer` | 14 / 22.75 / 500 | 26 |
| `type-chat-response` | 15 / 26 / 400 | Chat Markdown source, see visual-chat-markdown.md |
| `type-chat-prompt` | 14 / 22 / 500 | 22's inner text container, not its bubble |
| `type-document` | 15 / 26.25 / 400 | 30 |
| `type-diff` | 12 / 19.5 / 400, monospace | 25 |

Document heading/code roles remain with the editor until its own component
pass. In particular 30's code snapshot `13.9995px / 23.0992px` derives from
`.9333em` and `1.65`; it must not become a globally fixed code font size.
Current control/menu 13 px styles and existing domain-specific text remain
as-is until the corresponding component pass. This is intentional incremental
adoption, not a claim that all 35 component groups now match.

## Verification

- `eslint app/layout.tsx`, `npm run typecheck`, `npm run build`, and
  `git diff --check` passed. Build retains the pre-existing dynamic filesystem
  tracing warning at `lib/workspace.server.ts:283`.
- Inspected production CSS: all 11 role utilities compile, their referenced
  variables resolve, and `leading-5.5` still compiles to 1.375rem (22 px).
  Seven Inter subset faces declare weight 100–900, plus the adjusted fallback;
  no Geist Mono face or reference-site hotlink remains.
- Native Chrome on the existing `test2` chat: `document.fonts` reports Inter
  100–900 loaded; its resource requests come from `http://localhost:3000`.
  At this initial check, body used Inter followed by the retained CJK stack
  (corrected in the Chinese-font follow-up below); code computes to the
  system monospace stack and retains its existing 13 px size.
- Checked the existing Chinese/English chat, Settings > General theme selector
  and New task form. Light and dark switching works; the original Light
  preference was restored. No task/message was submitted, and no document or
  chat draft was edited. No editor or backend behavior was reimplemented/tested
  as part of this visual-only pass.
- Desktop CSS viewport width 1162 px (Chrome at the existing 110% zoom) and
  responsive 390 × 700: no document-level horizontal overflow. Chinese text
  reflows at the narrow width; control labels remain contained. This is a
  smoke check of these pages, not all components or all responsive states.
- Achromatic OKLCH token contrast calculations: light main text on white
  **19.79:1**, muted text on white **4.73:1**, sidebar text on sidebar **9.95:1**,
  primary button text **17.16:1**; dark main text **17.16:1**, muted text on card
  **5.83:1**. These pairs exceed 4.5:1, with colors unchanged from the starting
  working tree. They are token-pair calculations, not a full accessibility audit.
- Known source limitation: muted foreground on muted background is **4.34:1**
  light / **4.01:1** dark, below 4.5:1 for normal-size text. Retained for source
  fidelity; do not claim every small-text combination passes. Component alpha,
  disabled opacity, focus and error states still need their own future checks.
- No reference-site dark rendering was available. Chinese fallback on other
  operating systems, font-build pixel equivalence and unvisited states remain
  unverified. No new functional tests were added for this reversible CSS/font
  change; production compilation and actual-page checks cover its scope.

## Chinese-font follow-up — 2026-11-18

The initial explicit CJK fallback caused a visible mismatch across Chinese
text. This follow-up changes only `--font-sans` in `app/globals.css` to
`var(--font-inter), sans-serif` and updates this record. No component weights,
font sizes, line heights, layout rules, editor settings or dependencies change.

Evidence comes from Chrome DevTools **Rendered fonts**, not just the computed
`font-family` list, in the same local Windows/Chrome profile:

| Sample | Actual Chinese face | CSS weight / size / line-height |
| --- | --- | --- |
| ScientistFlow assistant paragraph before | Microsoft YaHei UI (`MicrosoftYaHeiUI`), local | 400 / 14 px / 22.75 px |
| ClawsGo user message | Noto Sans SC (`Noto-Sans-SC-Medium`), local | 500 / 14 px / 22 px |
| ScientistFlow assistant paragraph after | Noto Sans SC (`Noto-Sans-SC`), local | Existing 400 role retained |
| ScientistFlow user message after | Noto Sans SC (`Noto-Sans-SC-Medium`), local | 500 / 14 px / 22 px |

The explicit Microsoft YaHei UI entry took precedence over the browser's
Chinese sans-serif fallback. Removing the override lets both applications use
the same local Noto Sans SC face on this machine; it does not install Noto or
claim that every OS/browser defaults to it. Inter remains the actual Latin face,
served by Next from the application. The reference's Noto Serif SC webfont is
not evidence for the default Chinese UI font and is not introduced here.

Validation: `npm run typecheck`, `npm run build` and `git diff --check` passed.
The build still reports the existing filesystem tracing warning at
`lib/workspace.server.ts:283`. Inspected Chinese/Latin chat wrapping at desktop
and at the narrower DevTools-docked viewport; tested Light and Dark, and typed
Chinese into the New task name field without submitting. Restored the original
Dark setting and cancelled the form. No messages, tasks or files were created.
No new runtime or functional test is warranted for this font-token-only change.

This establishes the sampled Chinese face/weight match on the current machine,
not a full component or cross-platform visual match. Browser zoom differs by
site (ScientistFlow 110%, reference 100%), so screenshot pixel sizes are not
used to infer CSS sizes. Reference dark rendering, other operating systems and
all other component states remain outside this follow-up's verification.
