# Chat presentation

The complete chat presentation follows the official Base UI
[Message](https://ui.shadcn.com/docs/ai-elements/base/message),
[Chat](https://ui.shadcn.com/docs/ai-elements/base/chat) and
[Prompt Input](https://ui.shadcn.com/docs/ai-elements/base/prompt-input) patterns.
The old `components/ai-elements` wrappers have been removed after migrating
their last consumers. All controls now come directly from `components/ui`.
No package upgrade or database change is required.

## Responsibilities

- `components/chat-interface.tsx` submits messages to the Next.js chat route,
  polls the active reply, and reconnects to the saved transcript when the page
  reopens. The Stop button cancels the active turn on the server.
- `components/chat-transcript.tsx` renders identity lines, message surfaces,
  ordered content and the official scroller. Avatars live in the identity line,
  allowing the body to align with their outer edge. Mentions share the first
  paragraph's inline flow, with no hanging indent on wrapped user text.
- `components/chat-message-actions.tsx` provides real clipboard actions in
  `MessageFooter`. Do not display nonfunctional feedback, edit or retry actions.
- `components/chat-markdown.tsx` maps Streamdown code fences to Base `CodeBlock`,
  `CodeBlockLine` and copy controls, reusing the installed syntax highlighter.
  Stale highlighting callbacks cannot overwrite a newer code revision.
- `components/chat-composer.tsx` composes `InputGroup`, a send/stop button
  and an inline @mention picker for chat members and workspace files. Multiple
  addressed bots respond in mention order, each using its own Deep Agent.
  RHF and the shared Zod schema validate without changing
  whitespace; composition and Shift+Enter never submit. Pending submissions
  cannot clear a newer draft, and a disabled control does not dim the group.
- `components/chat-activity.tsx` renders reasoning, tools, sources, approvals
  and file outputs using Trace, CodeBlock, Item and Attachment.
- `lib/chat-presentation.ts` interprets SDK parts, preserves chronological
  handoff attribution and restricts source/image URL schemes.

Successful handoffs split the assistant turn into sender and recipient
segments. The final metadata bot ID must not reattribute earlier text. Only
public identity and the handoff reason are displayed, never returned model
instructions. Unknown group speakers remain Assistant.

## Supported display

Reasoning uses actual `reasoning` parts. Generic static/dynamic tools expose
pending, running, preliminary, complete, error, approval and denied states.
Incomplete historic/interrupted calls do not animate indefinitely. Tool
input/output is text, with a visible 32,768-character display limit; oversized
approval input cannot be approved without a complete review.

The browser fixture exercises approval controls with simulated requests.
Production Deep Agents use the bot's assigned skills and HTTP tools. Group
chats also support handoffs and project decisions.

Existing Streamdown plugins render Markdown, highlighted code, CJK, KaTeX
(`$$…$$` by default) and Mermaid. HTTP(S) sources are links; document sources
are labels. File parts display safe raster image outputs or attachment links.
There is no new chart-data protocol, workflow engine, model image-generation
tool or code execution capability.

The official example uses a soft muted code surface, language label, line
numbers and a copy control; these now apply to both Markdown and tool output.
The project retains its 13 px text, 28 px identities and circular icon controls.
Mermaid has no Base UI primitive: keep its installed renderer, with the same
neutral surface, themed labels and existing zoom/export/fullscreen controls.

## Verification

Run with Node 22:

```powershell
npx tsx --test tests/chat-presentation.test.ts tests/chat-bot-text.test.ts tests/chat-bot-context.test.ts tests/chat-composer.test.ts
```

`tests/fixtures/chat-ui.tsx` is an isolated browser fixture using AI SDK's
simulated stream, the real transcript renderer and shared `ChatComposer`. It exercises reasoning,
tools, errors, approvals, Markdown/Mermaid/math, stopping, scrolling, draft
retention and narrow/dark layouts without credentials, models, database
writes or real tool side effects. Temporarily mount it from a development
route for visual testing; do not ship that route.

Production transport behavior beyond persisted transcript rendering still
requires an actual task run. Fixture success is not evidence that a new
production tool or approval policy exists.
