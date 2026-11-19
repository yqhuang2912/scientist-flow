# OpenRouter model connections

Historical acceptance of the first model-connections implementation. The current runner requires an explicit model for every bot. See [independent handoff verification](../independent-handoff/verification.md).

Verified in the local ScientistFlow installation on 2026-11-19. Settings → Model connections supports adding an account, fetching its model catalog, replacing its key, and disconnecting it. In Settings → Bots, the model picker groups search results by connection. Choose a model and an optional reasoning effort, then save the bot.

## Live conversations

- [Iris direct chat](http://localhost:3000/chats/l_auqcqf9GZLJ4g7kUKHS) returned `OR-FREE-A 5`.
- [Free model handoff m9q5u](http://localhost:3000/chats/6lNQQH-uNKxnfuwlxOBCb) contains the successful eight-times-nine handoff and the final seven-times-nine handoff. After a page reload, the final reply was `63, Rowan m9q5u`. [Screenshot](./handoff.png)
- [Rowan direct chat](http://localhost:3000/chats/6rXP8OTp87BRHFkHyBZY5) returned `FREE-ROUTE 9` using the workspace default while Iris’s explicit connection was disconnected. Iris’s composer displayed `Disconnected. Check Model connections.` and restored the unsent message. The connection was then restored and Rowan was set back to Lightning.

The installation had one real OpenRouter API key. All live model requests used explicit `:free` model IDs for which the account catalog listed zero prompt and completion prices. The workspace default and the saved connection used that same account. The installed OpenRouter adapter reported the response model and completion ID in the response stream. Effort below is the value observed in the serialized outbound HTTP body. “Omitted” means the provider received no reasoning override.

| Chat / step | Bot ID | Connection / revision suffix | Requested model | Outbound effort | HTTP | Response model | OpenRouter completion ID |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Iris direct / 0 | `Vk9A6LL3VAs_efQqIxMnR` | `dNbS7PNu / Hz7agrTs` | `baidu/ernie-5.5-flash-preview:free` | high | 200 | `baidu/ernie-5.5-flash-preview:free` | `gen-1795096884-KPFHDLcULwHvblSOY78o` |
| Group, final turn / 0 | `Vk9A6LL3VAs_efQqIxMnR` | `dNbS7PNu / myfOzlgL` | `nvidia/nemotron-3-ultra-550b-a55b:free` | medium | 200 | `nvidia/nemotron-3-ultra-550b-a55b:free` | `gen-1795097869-6ICiVKJYooAO7Jm61dl4` |
| Group, final turn / 1 | `kTC_moW3vNO_kDlMh5fim` | `dNbS7PNu / myfOzlgL` | `nvidia/nemotron-3.5-lightning:free` | Omitted | 200 | `nvidia/nemotron-3.5-lightning:free` | `gen-1795097873-oJTHucoKUXTTIVma4oMr` |
| Rowan direct / 0 | `kTC_moW3vNO_kDlMh5fim` | workspace-default | `baidu/ernie-5.5-flash-preview:free` | Omitted | 200 | `baidu/ernie-5.5-flash-preview:free` | `gen-1795097613-RZRFEAvAEXFE8v00vlUu` |

Trigger runs were `run_06gv874jf067hccttdbh3kjga2` (Iris direct), `run_06gv88b32lqff4j3dj389m03a2` (group), and `run_06gv89tlfbbr9ih4rffkjee7a2` (Rowan direct). The group also contains earlier attempts where the free Gemma or ERNIE endpoint returned HTTP 429. One attempted handoff from the explicit connection to the workspace default reached the latter and returned 429. The two successful handoffs used the explicit connection for both speakers.

## Isolation checks

- An isolated Neon installation and mocked OpenRouter catalog used two distinct test keys. Checks covered concurrent creation with identical model IDs, encrypted storage, cross-installation denial, a catalog refresh arriving after credential rotation, a late 401 from a retired key, model removal, and disconnecting one connection while the other remained usable.
- The installed AI SDK and OpenRouter adapter serialized two concurrent requests against an isolated HTTP transport. The tests checked the actual Authorization and reasoning fields for each fixture. An SDK tool-call handoff checked the recipient’s first request, including removal of prior provider-specific reasoning metadata. Secrets and prompts are excluded from the application’s request receipts.
- A browser fixture supplied two connection catalogs to the actual bot editor. The same model was selectable under both headings. Searching by nickname narrowed the group, and switching from a supported effort to a default-only model cleared the effort. The real editor was also exercised against the live account and reloaded to check persisted choices.

## Installation boundary

This feature is for a single trusted local installation with a dedicated Neon database and Trigger project/worker. Start Next on loopback using the project scripts. Both Next and the worker need the same private `SCIENTISTFLOW_INSTALLATION_ID` and `SCIENTISTFLOW_MODEL_MASTER_KEY` from server configuration. Generate a stable UUID and an independent random 32-byte base64 key once per installation. See [.env.example](../../.env.example). Keep the master key separate from Neon and out of client environment variables. Changing or losing it requires re-entering account keys.

The workspace default continues to use the worker’s `OPENROUTER_API_KEY`. An explicit selection requires its own current connection and accessible model. Disconnection removes the encrypted key and prevents new requests. A request already accepted by OpenRouter can finish. Public reverse proxies and shared multi-user deployments require separate user authentication and authorization before enabling this feature.

The account catalog comes from [OpenRouter’s user model API](https://openrouter.ai/api/v1/models/user). The picker intersects declared per-model efforts with the installed adapter’s supported values. Unknown effort levels leave the provider default available. The catalog shows account visibility and capabilities. Current quota and endpoint availability are determined at request time.
