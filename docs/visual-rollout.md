# Sequential visual rollout — 2026-11-18

Reference: `C:/Users/tsmot/Documents/Codex/2026-11-15/ni-s/research/clawsgo-design-full/visual-system`.
Continue the completed foundation / Button / Input / Select passes. Work on
`master`, one component family at a time, without commits or deployment.
Only presentation changes: retain navigation, layout structure, data, editor
state and background task behavior. Reference computed dimensions are evidence,
not fixed sizes when their source rule is intrinsic or responsive.

Each task: inspect source + resolved + computed + declared states, map current
components, implement a minimal change, run scoped checks, then proceed.
Live checks distinguish product pages from isolated fixtures; unavailable
reference states are never claimed as pixel-matched. Dark reference values
are source-declared, not reference-browser verified.

| Order | Reference | Task | Status |
| --- | --- | --- | --- |
| 1 | 11 | Combobox | Complete; single-value fixture checked; chips not exercised |
| 2 | 12 | Switch | Complete; default toggle and small on-state checked |
| 3 | 13–14 | Badge / Avatar | Complete; badge fixture and existing portraits checked |
| 4 | 15 | Dialog / AlertDialog | Complete; New task, Settings, delete inspection/cancel checked |
| 5 | 16–17 | Settings / application navigation | Complete; existing pages in both themes checked |
| 6 | 18 | Dropdown / context / menubar | Complete; dropdown/context checked; menubar static checks only |
| 7 | 19 | Tabs | Complete; default/panel and vertical keyboard activation checked |
| 8 | 20–21 | Resource cards / list rows | Complete; unused variants checked in isolated fixture |
| 9 | 22–26 | Message / activity / output / composer | Complete; product rendering and isolated stream/draft checked |
| 10 | 27–30 | File tree / window / Markdown presentation | Complete; product + isolated tree/document checked |
| 11 | 31 | Search | Complete; filtering, keyboard highlight and escape checked |
| 12 | 32–33 | Progress / empty state | Complete; fixture and uninitialised workspace checked |
| 13 | 34–35 | Surface / typography audit | Complete; Settings and reading roles checked |
| 14 | All | Integration review, typecheck, build, browser checks | Complete; checks passed, scope/limits recorded below |

## 11 — Combobox

Mapping: `components/ui/combobox.tsx`; no product callers at audit time.
Adopt 32px minimum chip-input height, 18px radius, input/50 surface,
3px ring at ring/30, 200ms color/shadow transition. Chips: 21px high,
12/16px medium, 18px radius, input surface (60% in dark); remove target
18px with 12px icon and -2px start margin. Popup: radius 18px, popover/70,
shadow-lg, 1px foreground/5 ring (10% dark), blur 40px/saturate 150%.
List padding 4px, no added inter-row gap. Items: minimum 28px,
14/20px medium, padding 6px vertical / 8px left / 32px right, radius 14px.
Retain anchor/available-space sizing and Base UI behavior.

## 12 — Switch

Mapping: `ui/switch.tsx`. Default 32 x 20px, small 24 x 16px;
2px track border, 16/12px thumb, checked translation `100% - 4px`,
18px radius, thumb shadow-sm. Off uses input/90; on uses primary
for border and surface. Focus ring 3px / 30%; reduced motion disables transitions.
No product callers; no settings added. Lint and typecheck passed.

## 13–14 — Badge / Avatar

Mapping: `ui/badge.tsx`, `workspace-folder-dialogs.tsx`, `ui/avatar.tsx`,
`chat-avatar.tsx`. Badge radius changes from 26 to 18px. Add compact
16px and count 18px height variants, 10/14.2857px medium, 6px horizontal
inset; retain default 20px/12px. Workspace confirmation metadata uses compact.
Reference rounded-2xl is 25.2px under local radius14, not a global token.
Avatar anatomy/surfaces already match; keep project-specific 28px Bot/User
portraits (explicit prior requirement), 40px editor preview and existing
24px small variant. Do not shrink every portrait to the sole account sample.
Lint and typecheck passed.

## 15 — Dialog

Mapping: `ui/dialog.tsx`, `ui/alert-dialog.tsx`, redundant workspace footer
classes. Adopt title 16/16px medium, description/body 14/20px,
radius `min(radius-4xl,24px)`, black/30 overlay with supported 8px blur.
Existing shadow-xl, foreground/5 ring (10% dark), header gap6 and footer
gap8 already match. Keep application form panel footer and responsive widths,
scrolling, cancel-first focus and modal behavior. The reference management
window 720/860px widths and 600/640px max heights are not universal form sizes.
Reduced-motion disables overlay/popup animation. Lint/typecheck passed.

## 16–17 — Navigation

Mapping: `ui/compact-styles.ts` navigation-only exports, `ui/sidebar.tsx`,
`settings-shell.tsx`. 30px rows, 14/20px medium, settings gap6 / app gap8,
19.6px radius via `radius-xl * 1.4`, sidebar-accent for hover/selected,
3px keyboard ring. Keep previously requested 6px application left inset,
28px portraits, circular 32px collapsed controls, sidebar width/resizing
and responsive settings layout. No global compact row replacement.
Reference is source + light resolved; static checks passed.

## 18 — Menus

Mapping: `ui/menu-styles.ts`, DropdownMenu / ContextMenu / Menubar.
Shared popup: 18px radius, padding4, popover/70, shadow-lg, ring foreground/5
(10% dark), blur40 / saturation150, no animation per sampled override.
Shared single-line menu rows: height30/min28, 14/20px medium, gap6,
padding6 vertical/8 horizontal, radius14. Labels 12/16 regular, separators
foreground/5, inset28. Preserve destructive, checked, disabled and focus
semantics; radio/check indicators keep their own reserved space.
ContextMenu/Menubar are adaptations of the dropdown family, not separately
measured reference components. No fixed content widths or reference labels.

## 19 — Tabs

Mapping: `ui/tabs.tsx` (no product callers). Default list32px/p3/r18,
muted surface; panel density34px with 13/19.5px labels versus default
14/20px. Active indicator uses Base UI active-tab dimensions, background
surface, r18 and 200ms motion with reduced-motion opt-out. No label widths
are frozen. Existing line variant keeps its underline; forward orientation
to the primitive so vertical appearance and keyboard behavior agree.

## 20–21 — Resource surfaces

Mapping: `ui/card.tsx`, `ui/item.tsx`. Card base source spacing20 (small16),
radius capped24, ring5% (dark10%). Resource variant: border, transparent,
r18, vertical14, gap8, no shadow/ring, hover accent/50; title14/20 medium,
description13/snug. Item resource variant: border/r18, padding12 vertical /
16 horizontal, title14/20. Both keep intrinsic heights; reference card
145.625px / skill row73px are content measurements, not constants.
No product resource/Skill page exists; variants are isolated fixtures only.
Existing approval Item keeps its geometry; its focus ring aligns at3px/30%.

## 22–26 — Chat presentation

Mapping: Bubble, Trace, CodeBlock, InputGroup, ChatComposer, ChatTranscript.
User bubble14/20 medium, r18, 14px horizontal/8px vertical, surface token,
85% desktop cap (mobile retains full available width). Assistant body retains
its existing14/22.75 reading scale and identity/optical alignment in the initial
pass. The follow-up [chat typography correction](./visual-chat-markdown.md)
replaces that omitted prose role with15/26 and explicitly sets user text14/22.
Steps use15/24 medium and vertical8, distinct from message prose. Compact
output keeps12/19.5 mono/r14 and drops the extra ring per reference24.
Existing diff line variants remain; no new diff/terminal functionality.
Composer variant: r22, border, chat-input surface, shadow-sm, vertical4;
textarea14/22.75 medium, horizontal16/vertical8, min52/max192.
Keep textarea, draft, IME, Enter/Shift+Enter, send/stop and subscriptions.
No reference context strip is added because no equivalent feature exists.

## 27–30 — Workspace and documents

Mapping: Button row variant, WorkspaceFileTree, DocumentWindow,
DocumentMarkdown TSX/CSS. Tree28px/13px/18.5714px medium, gap6,
left10/right32, radius19.6; retain 16px child indentation, monochrome
icons, sibling menu buttons, whole-row hover/selection and all handlers.
Floating window r22/background; shadow-xl is a deliberate floating-layer
adaptation of the inline reference shadow-sm. Keep the44px existing title
bar and bounds/drag/resizing; title13/19.5, footer12/16. No new file tabs.
Markdown preview15/26.25 regular; H1 24/32.4, H2 1.3333em, H3 1.1333em,
weight600/leading1.35, tracking-.01em. Remove custom H1/H2 rules.
Code .9333em (13.9995px)/1.65, title12/19.8, r14. Source CodeMirror
remains13px mono with original syntax/theme/configuration and state.
Reference30 is an editor; preview mapping preserves semantic paragraphs,
lists and existing accessible tables instead of copying its DOM rules.

## 31 — Search

Mapping: `ui/command.tsx`. Inherit shared dialog r24; retain existing
width and content-driven height. Input32px/r18/input50 with14/20 medium;
keyboard ring3/30 now targets cmdk input explicitly. Wrapper/group p4,
gapless results with min28px, padding6/8, r14,14/20 medium and selected
muted surface. Group captions12px. Activity dates remain metadata12/16
instead of adopting the reference shortcut component's contextual14px.
Keyboard search/filter/selection behavior remains with cmdk.

## 32–33 — Progress / empty states

Mapping: `ui/progress.tsx`, `ui/empty.tsx`. Progress track8px, compact6px,
r18 with inherited theme, dynamic indicator still entirely controlled by
Base UI values; reduced-motion disables transitions. The reference6px
track and25.2px radius come from local overrides, not progress percentages.
Empty radius22/p20, title16/24 medium and supporting14/20. Keep existing
centered Empty structure and callers; reference33 is a clickable starter
card, so its336/160px minimum heights, left layout and hover background
are deliberately not imposed on noninteractive workspace/chat empty states.
No onboarding cards or actions added.

## 34–35 — Surface / text roles

Mapping: SidebarInset (unused in the current layout), Settings panels/shell,
compact control typography, EmptyTitle/welcome page. SidebarInset radius22
only for its existing inset mode. Current edge-to-edge dashboard remains:
adding reference margins or another surface wrapper would change layout.
Settings headings16/24 medium; row labels14/20 medium, descriptions14/20
regular, path12px mono. Bot selection/control rows14/20 medium, without
changing30px heights or28px portraits. Welcome heading30/36 medium via
a public EmptyTitle size variant. Existing UI font, semantic colors,
Chinese fallback, editor syntax themes and task identities remain intact.

## Integration validation

- Each family passed scoped ESLint and `npm run typecheck` before the next.
  Final scoped ESLint includes every changed TS/TSX file plus the shared menu
  styles and new fixture. Final typecheck passed after removing the audit route.
- `npm test` passed (server and client suites); client suite reports 70 tests,
  no failures/skips. Existing server fixtures create guarded temporary directories;
  no project workspace data is used for their deletion/save tests. Coverage includes
  path boundaries, version conflicts, document request races, draft/save states,
  tree cache updates, responsive panel bounds, IME and chat presentation.
- The focused composer/presentation run also passed all 14 tests before integration.
- `npm run build` passed with Next16.4.5. Its sole warning is the pre-existing
  dynamic filesystem tracing warning at `lib/workspace.server.ts:283`; no attempt
  was made to change workspace filesystem behavior in this visual pass. The route
  output contains only the original application routes, not the audit fixture.
- Browser: native Chrome on Windows, existing 110% desktop zoom (approximately
  1162 x 557 CSS-pixel viewport), plus 390 x 700 responsive emulation. Rendered
  pixel snapping is not a new token: e.g. the 32px tab list measures 31.99px.
- Product pages: dark New task, light/dark Settings, light search/filter and
  keyboard highlight, existing chat in both themes, actual Workspace empty state,
  existing tree, Markdown floating window, minimise/restore and close. Inspected
  the existing file deletion dialog and cancelled; no delete was submitted.
  At 390px the Settings navigation wraps, helper text wraps and the invalid path
  feedback/buttons remain visible. The original Dark preference was restored.
- Isolated controls: filter Combobox to `Py`, choose Python by keyboard; toggle
  default Switch; inspect small on-state and all three badge sizes. Tabs default,
  panel density and vertical orientation render; Left/Down + Space activate tabs;
  indicator follows selection and disabled tab stays disabled. Dropdown disabled
  and destructive styles, progress 40%/70%, resource surfaces and empty state render.
- Computed checks: default Switch height20/radius18; tab trigger14/20/500/radius18;
  progress track8/radius18; Empty title16/24/500. Resource titles initially inherited
  `leading-snug`; explicitly corrected the resource variant to14/20/500 and verified
  both CardTitle and ItemTitle in Chrome. Resource height remains content-driven.
- Isolated file tree: 256px width truncates long names; folder error text wraps.
  Opening file ellipsis or folder context menu left toggle count at0. Choosing
  New folder reports `create: docs`, keeps selection and does not collapse the tree.
- Isolated document: typed Chinese/English into the existing CodeMirror editor;
  Preview renders the same unsaved buffer. No real file was written. Actual file
  preview read-only check also rendered headings, code and math, then restored
  correctly after minimising. Source editor implementation was not changed.
- Isolated chat: a local mocked long response progressed through thinking/tool
  status and all20 text items to `ready`. During streaming, changed theme and chat
  width to375px; the unsent Chinese/English composer draft survived and the stream
  continued. No model request, real agent run or database message was created.

### Reusable fixture and screenshots

`tests/fixtures/visual-system.tsx` composes existing controls, chat/tree fixtures
and the existing editor/preview. Its interactions only change memory. To rerun
locally, temporarily expose it from a development route; the temporary
`app/visual-audit/page.tsx` used here was removed before production build.

- [Light controls, isolated fixture](./screenshots/visual-rollout/controls-light.png)
- [Dark Settings, actual page](./screenshots/visual-rollout/settings-dark.png)
- [390px Workspace settings, actual page](./screenshots/visual-rollout/settings-mobile.png)

### Verification limits and deliberate differences

- Reference light measurements and declared source rules guide this pass. Dark
  was checked in ScientistFlow, not rendered in the reference application; this is
  not a claim of dark pixel parity. Other browsers/OS fonts were not tested.
- Not every variant/state was exercised: chips/multiselect, Menubar, line tabs,
  reduced-motion simulation, indeterminate progress and exhaustive focus/disabled
  combinations have static checks only. No reference values were invented for them.
- Context menus, AlertDialog and the floating window reuse the closest reference
  family while retaining their application semantics. Existing menu widths, form
  footers, three-column layout, portrait sizes and document editor remain intact.
- No live Trigger.dev task was started. The stream check uses the existing mock
  transport; real external-app launch and remote background execution were out of
  scope. Existing browser-extension message-channel errors were visible in DevTools;
  this report does not claim an empty browser console.
- The existing workspace delete copy is Chinese and was left unchanged: this pass
  preserves content and functionality. Screenshot path validation is an existing
  state; no root-directory change was submitted.
- No dependencies, schemas, server actions, routes, permissions or task logic were
  changed. All work remains uncommitted on `master`; no push or deployment.
