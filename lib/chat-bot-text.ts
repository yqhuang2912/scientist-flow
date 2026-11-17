import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai"

type Speaker = { name: string; job: string }

function speakerPrefixes(bots: Speaker[]) {
  return [
    {
      text: "[Historical assistant speaker: an unspecified bot]",
      wrapper: false,
    },
    ...bots.flatMap(({ name, job }) => {
      const identity = `${JSON.stringify(name)} (${JSON.stringify(job)})`
      return [
        { text: `[Historical assistant speaker: ${identity}]`, wrapper: false },
        { text: `[${name} (${JSON.stringify(job)}):`, wrapper: true },
        { text: `[${identity}:`, wrapper: true },
      ]
    }),
  ]
}

/** Remove only known model-echoed speaker prefixes, never arbitrary Markdown. */
export function cleanBotText(text: string, bots: Speaker[], streaming = false) {
  const prefixes = speakerPrefixes(bots)
  let body = text
  let wrappers = 0
  let removed = false
  for (;;) {
    const candidate = body.trimStart()
    const prefix = prefixes.find(({ text }) => candidate.startsWith(text))
    if (prefix) {
      body = candidate.slice(prefix.text.length)
      wrappers += Number(prefix.wrapper)
      removed = true
      continue
    }
    // Withhold only a possible protocol prefix while its tokens arrive.
    if (streaming && prefixes.some(({ text }) => text.startsWith(candidate))) {
      return ""
    }
    break
  }
  if (!removed) return text
  body = body.trimStart()
  if (streaming && wrappers > 0) return body.replace(/\]+\s*$/, "")
  // A copied wrapper may be unclosed (the reported bug), or close at the end.
  // Balanced Markdown such as [docs](url) or [1] must keep its own brackets.
  let excessClosing = [...body].reduce(
    (count, char) => count + (char === "]" ? 1 : char === "[" ? -1 : 0),
    0
  )
  while (wrappers > 0 && excessClosing > 0 && /\]\s*$/.test(body)) {
    body = body.replace(/\](\s*)$/, "$1")
    wrappers--
    excessClosing--
  }
  return body
}

/** Runs before UI chunks and response persistence, including split prefixes. */
export function botTextTransform<TOOLS extends ToolSet>(
  bots: Speaker[]
): StreamTextTransform<TOOLS> {
  return () => {
    const active = new Map<string, { raw: string; emitted: string }>()
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type === "text-start") {
          active.set(chunk.id, { raw: "", emitted: "" })
        } else if (chunk.type === "text-delta") {
          const state = active.get(chunk.id)
          if (!state) {
            controller.enqueue(chunk)
            return
          }
          state.raw += chunk.text
          const cleaned = cleanBotText(state.raw, bots, true)
          const delta = cleaned.slice(state.emitted.length)
          if (delta) controller.enqueue({ ...chunk, text: delta })
          state.emitted = cleaned
          return
        } else if (chunk.type === "text-end") {
          const state = active.get(chunk.id)
          if (state) {
            const delta = cleanBotText(state.raw, bots).slice(
              state.emitted.length
            )
            if (delta)
              controller.enqueue({
                type: "text-delta",
                id: chunk.id,
                text: delta,
              })
            active.delete(chunk.id)
          }
        }
        controller.enqueue(chunk)
      },
    })
  }
}
