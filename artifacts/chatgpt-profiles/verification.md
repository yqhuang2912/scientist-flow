# ChatGPT subscription profiles

Verified on 19 November 2026 with local ScientistFlow, its Trigger development worker, and one real ChatGPT registration. The user completed OpenAI authorization in the browser. ChatGPT A returned 10 visible models. The public connection ID ends in `cqIuEQKp`. The same two bot bindings survived an account rename and restoration of its original label.

## Real conversations

[Replay the group handoff](http://localhost:3000/chats/YX3ha9dLYBdgYjQcBdYi-). Iris passed the user's multiplication check to Rowan through the handoff tool. Rowan answered **63, Rowan**. Reloading the chat preserved each speaker and message. [Chat screenshot](handoff.png) · [Account settings screenshot](settings.png)

| Bot | Connection | Requested and returned model | Serialized effort | HTTP and stream terminal | Execution ID | Message ID |
| --- | --- | --- | --- | --- | --- | --- |
| Iris | ChatGPT A | gpt-6.2-sol | low | 200 · response.completed | kslAnwVQGA-eS_GsBIBmC | xBzDyX2qDl2mRay47lo6r |
| Rowan | ChatGPT A | gpt-6.2-sol | medium | 200 · response.completed | HEVB76CiqQnylzwHFm7GE | VrWc5qi2R1VpMO38pCiic |

The local worker recorded outbound requests `qjnTL9d3DCspiaVpYv6QF` and `34IZn6TeHKYjRp6_QWW80`. Rowan's execution points to Iris's execution as its parent. In a separate [direct chat](http://localhost:3000/chats/bMDonvS05Yxz_dqo2okA4), Rowan answered **42, Rowan** using the same account and medium effort.

## Verification boundaries

A second live registration was unavailable. Two isolated synthetic vault registrations, separate Neon bot bindings, and a test HTTP transport verified same-model requests with distinct credentials and efforts, B-only revocation, and continued A access. Separate processes exercised refresh token rotation against the same temporary vault. No live grant was revoked for these tests.

Some initial Trigger development dispatches returned `COULD_NOT_FIND_EXECUTOR` before inference. The links above identify conversations with completed model requests. The production build retained the existing dynamic filesystem tracing warning in the workspace module.

The app uses the official [authorization and registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [per-registration session handling](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), and the [subscription Responses API](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
