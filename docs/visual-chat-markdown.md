# Chat Markdown typography correction — 2026-11-18

The first visual pass retained the old assistant prose scale. Reference component
30 is the document editor, not chat Markdown; component 23 is a tool step.
Neither should supply the assistant paragraph's line height.

## Mapping and evidence

| Current component | Reference | Difference addressed | Files |
| --- | --- | --- | --- |
| Assistant ChatMarkdown | Chat Markdown style declaration, supplemental to the 35-group index | Inherited14/22.75 becomes explicit15/26 regular | globals.css, chat-markdown.tsx |
| User ChatMarkdown | 22, inner `leading-5.5` text container | Bubble14/20 becomes explicit text14/22 medium | globals.css, chat-transcript.tsx |
| Paragraph/list rhythm | Reference and installed Streamdown defaults | Remove the extra descendant paragraph margin rule | chat-markdown.css |

Reference files in the supplied `visual-system` directory remain the foundation.
The missing chat prose declaration was additionally located in the public assets
linked by the reference page on 2026-11-18:

- `https://app.clawsgo.ai/assets/markdown-BwGBe-Mp.js`: exported Markdown style
  uses `text-[15px] leading-6.5`. No added tracking or word spacing.
- `https://app.clawsgo.ai/assets/ChatMessageParts-DRbsI_EJ.js`: text replies use
  that Markdown style. No reference business implementation was imported.
- `https://app.clawsgo.ai/assets/chunk-BO2N2NFS-qeCpb_RQ.js`: the Streamdown
  wrapper uses `space-y-4`, matching the installed renderer. Both use list-item
  padding4px vertically. The supplied `firecrawl-stylesheet.css` defines
  `leading-6.5` as spacing×6.5 =26px and `space-y-4` as spacing×4 =16px.
- Reference22 computed snapshot and the prior font verification record confirm
  user text14/22/500. A live expanded reasoning block was also inspected and
  measured14/24/500; that is a separate role and was not mistaken for the reply.

The available reference conversation had stopped before a final answer. Thus
15/26 is verified from source declarations, not claimed as a newly rendered
reference answer measurement.

The follow-up audit removed the local heading size overrides. Streamdown supplies
H1 through H6 at 30/36, 24/32, 20/28, 18/28, 16/24 and 14/20 px. The reference
adds bold serif styling to H1. Inline code uses the renderer’s 14/20 px monospace
with 6 px horizontal padding, the surface color and the small radius. Table headers
use the same surface at 80% opacity. Expanded reasoning uses its measured 14/24 px
medium text and a 224 px scroll height limit.

Chrome computed-style checks passed at 1080 px in light mode and 375 px in dark
mode. They covered all six heading levels, prose, inline code, table headers and
the expanded reasoning text. The fenced code block rendered in both cases and
neither sample overflowed the viewport. The application retains its interactive
table, fenced code and Mermaid controls.

## Validation

The isolated `tests/fixtures/chat-typography.tsx` sample exercises Chinese,
English, mentions, multiple paragraphs, lists, nested lists, quotes and inline
code through the actual ChatTranscript. It creates no model requests or records.
Chrome on Windows, at the existing110% zoom: checked both themes and375px
content width, then restored Dark and the original chat tab. Computed assistant
paragraph/list text is15/26/400; user paragraphs14/22/500; letter spacing normal,
word spacing0px; direct paragraph margin16px; list vertical padding4px. Checked
mentions and wrapped lines, nested lists, quotations, inline code, and existing
code/math/Mermaid rendering. The original chat page also displays the new scale.

An initial reuse of the older chat fixture encountered stale development SSR
output after adding a button. The dedicated typography fixture was cold-loaded
and verified without that hydration error. Its temporary development route was
removed before build. No production route or chat lifecycle was changed.

Scoped ESLint, TypeScript and the14 existing composer/presentation tests passed.
Production build passed with only the existing dynamic filesystem tracing warning
at `lib/workspace.server.ts:283`. Its route list contains no audit route.
All changes remain uncommitted on `master`.
