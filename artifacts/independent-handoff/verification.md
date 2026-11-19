# Independent bot handoff verification

2026-11-19, local ScientistFlow, Trigger development worker `20261119.52`, OpenRouter. The [acceptance chat](http://localhost:3000/chats/UQ8RfEnWOn8qxxmL5wvly) contains the arithmetic turn, the project-evidence turn and the stop-button check. The bots and conversations remain available.

## Arithmetic turn

User message `z96DpLZW0IQ8Go93` asks Iris to delegate seven times nine to Rowan. Rowan's complete visible reply was **63，Rowan**.

| Author | Bot ID | Execution ID | Assistant message ID | Parent execution |
| --- | --- | --- | --- | --- |
| Iris | `6FFSsx6dMYHqVqq1nxL1G` | `QYigXM3jgfihh-pTYSSzX` | `HZmIRexjnxCdNT3mql76J` | — |
| Rowan | `4GSyzaa9brnZGlidBPQzE` | `DuZdPq1M7611gXMsQaacS` | `BCGu1TYp0bZQQDQvbv4hA` | `QYigXM3jgfihh-pTYSSzX` |

| First outbound request | Connection nickname / ID suffix | Serialized model | Serialized reasoning effort | HTTP | Provider response ID |
| --- | --- | --- | --- | --- | --- |
| Iris, step 0 | OR free m9q5u / `dNbS7PNu` | `nvidia/nemotron-3.5-lightning:free` | omitted | 200 | `gen-1795100287-nKeLXUHSl0KAIrov6QnB` |
| Rowan, step 0 | OR free m9q5u / `dNbS7PNu` | `nvidia/nemotron-3-ultra-550b-a55b:free` | `high` | 200 | `gen-1795100299-oSsAjYRSY1dy4PC8HODp` |

The two executions share Trigger run `run_06gv8k3t76v9f2hkv5mcri7ga2`. The request receipts are indexed by execution and step. The model adapter checks the serialized body and connection authorization before sending, then records the HTTP status and provider response metadata. The installation supplied one real account. All live acceptance requests used explicitly named free variants.

A fresh browser and a subsequent reload both restored the same three IDs in order, with Iris and Rowan rendered separately. An independent read through Trigger's default storage returned the same two assistant messages with their own author and execution metadata. [Browser after reload](./after-reload.png)

## Same-turn project evidence

In the next user message, Iris saved decision `D-138ab718d32a4857` before handing off to Rowan. The committed delegation references the decision and source passage zero of user message `Os0jhMHjsvBqXBvG`. The recorded evidence is “Plate R has seven rows of nine wells.”

| Author | Execution ID | Message ID |
| --- | --- | --- |
| Iris | `K1OcoeUJHDKdxObPkg9Yc` | `Bzl4NixynssbhyP-oMjr1` |
| Rowan | `A354DU7cJvOjJ9m3fKEFA` | `rzMZwWQeEnHtRI1nUYF6B` |

Rowan's saved answer, with Markdown formatting removed:

> Database decision ID: D-138ab718d32a4857\
> Exact evidence quote: “Plate R has seven rows of nine wells.”\
> Computed total: 63 (7 × 9 = 63)

The live delegation also names the quote. To verify that the recipient can independently obtain it from project records, the deterministic transport test sends a delegation containing only a public instruction to check the grid. It checks the recipient's serialized first request for both the committed ID and the quotation.

## Isolation and recovery checks

The actual turn runner, two isolated Neon connection records and the installed OpenRouter adapter ran against a test transport. The checks inspect the resulting requests in memory. They exercise both distinct models and the same model ID on two fixture credentials. Each recipient request carries its own identity, memory, tool schema, effort and credential, the public task and committed evidence. The assertions check that sender-only instructions, memory, skill text, thought, tool result, provider signature and previous-response pointer are absent. Peer speech has explicit member attribution and only the recipient's own prior speech has the assistant role.

Two concurrent deliveries of a new user message produced one pair of executions. Replaying a completed turn returned the same persisted messages. Revocation after Iris's accepted handoff produces an authored Rowan failure before any recipient request. An already disconnected target is rejected at dispatch. A browser click on **Stop response** in the acceptance chat cancelled execution `AEPP_CdmqKzuTX5jRWrMK` for user message `jALaOHV2DtkdOASb`.

The real forms were used to create both bots and edit their model choices. Reopening Rowan from the chat header restored Ultra / high. Cancelling an edit to medium preserved high. James's existing unconfigured direct chat refused to send and retained the draft. Iris's reasoning selector was read-only for Lightning. Selecting ERNIE 5.5 Flash Preview in an unsaved edit showed a disabled “Fixed · high” selector after refreshing the real catalog. The picker distinguishes omitted and nullable per-model effort lists according to [OpenRouter's reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#discovering-per-model-reasoning-options).

An [earlier free-endpoint trial](http://localhost:3000/chats/D3a6wwTE_4irJ78PLEVCG) includes a Particle request rejected with HTTP 429. The error was recorded on Rowan's execution. The successful runs above use Lightning and Ultra. Two additional attempts to start an isolated direct-chat stop check returned Trigger's `COULD_NOT_FIND_EXECUTOR` before the runner started. The stop check succeeded in the acceptance group.

## Direct chat and checks

The [Rowan direct chat](http://localhost:3000/chats/79gy2tgXsu1s7j0cEbjiD) returned **32** for four times eight. Execution `PhU2L4xDCxbhj0Nw3S8s-`, message `N77aAMjE3uYvLG9RgMMSz`, used the configured Ultra free model with high effort, HTTP 200 and response `gen-1795100625-XHp7HN9Hpm1Usq3t3SwR`. A browser reload restored that answer.

TypeScript, ESLint and the production build passed. The suite with the Neon integration cases enabled passed 207 tests and skipped the existing Windows file-symlink privilege test. The build emitted its existing dynamic filesystem tracing warning at `lib/workspace.server.ts:291`.
