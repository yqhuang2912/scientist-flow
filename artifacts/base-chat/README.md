# Chat layout verification

`message-alignment-wide.png` and `message-alignment-narrow.png` show the current
layout in the isolated browser fixture, using the production `ChatTranscript`.

Verified in Chrome:
- Sender avatars are in the identity header; the body reaches the avatar's
  outer edge instead of reserving an avatar column beside the body.
- Mentioned-user text wraps back to the `@` position on subsequent lines.
- Bold text and paragraph spacing are preserved.
- Both the normal layout and a 375 px fixture container remain readable.

The fixture does not call a model or write chat records. The temporary route
used for this verification was removed afterward. Earlier screenshots in
this directory document the previous Base component migration, not this
alignment revision.
