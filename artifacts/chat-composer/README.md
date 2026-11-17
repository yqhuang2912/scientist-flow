# Chat composer verification

Verified in Chrome with the real `ChatComposer` and the isolated AI SDK
transport in `tests/fixtures/chat-ui.tsx`. No model calls, database writes or
production task execution were used.

- Dark and light themes, including a 375 px content container.
- Chinese and English input; Shift+Enter inserts a newline; Enter sends.
- Bot selection updates the recipient without losing the draft.
- Sending clears the submitted input and switches the button to Stop response.
- Stopping a simulated long response returns to Send message and retains the
  next, unsent draft.
- A 16-line draft scrolls inside the textarea; the footer stays visible.
- Circular send/stop control, accessible labels and tooltip.

Screenshots: `dark.png`, `light-narrow.png`, and `chat.png` (actual chat page).
The temporary `/chat-ui-check` development route was removed after verification.
Browser automation stopped while closing the verification tab because it could
not determine the active URL; tab closure could not be confirmed. The original
dark theme was restored before visiting the actual chat page.

Scoped ESLint: no errors; one pre-existing unused `_id` warning in PromptInput.
Full TypeScript check: 18 pre-existing errors remain, down from 19 after fixing
the send button's Base UI event type. No new errors in this change. A production
build remains blocked by those type errors; it was not rerun for this styling change.

IME composition handling was preserved but was not exercised with a live IME.
