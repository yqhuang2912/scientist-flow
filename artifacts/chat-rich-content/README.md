# Compact code and Mermaid

The previous Streamdown defaults used 14 px (`text-sm`) for code/inline code,
compared with the chat body's 13 px. The chat-scoped skin now uses 13 px code,
12 px sans-serif language labels, one border and a 32 px header. Line numbers
are omitted for conversational snippets; copying preserves the original code.
Mermaid uses neutral semantic theme colors, 13 px sans-serif labels and compact
Lucide controls. No renderer, dependency, chat transport or agent was replaced.

Verification: scoped ESLint passed. Typecheck reports only the same 19 existing
legacy AI Elements errors. Chrome checks cover light/dark themes, a narrow
transcript, code copying, Mermaid zoom/reset, fullscreen/Escape and the download
menu. No new runtime tool was invoked.

References: [Streamdown scoped styles](https://streamdown.ai/docs/styling)
and [Mermaid configuration](https://streamdown.ai/docs/plugins/mermaid).
