import "server-only"
import type { UIMessage } from "ai"
import type { LiveText, TextFrame } from "./chat-live"

// The worker and the local Next server share a process. Durable turn progress
// also serves clients reconnecting after a restart or on another process.
type Topic = { listeners: Set<(draft: LiveText) => void>; latest?: LiveText }
const host = globalThis as typeof globalThis & {
  scientistFlowLive?: Map<string, Topic>
}
const topics = (host.scientistFlowLive ??= new Map())
function topicFor(key: string): Topic {
  let topic = topics.get(key)
  if (!topic) topics.set(key, (topic = { listeners: new Set() }))
  return topic
}
function prune(key: string, topic: Topic) {
  if (!topic.latest && !topic.listeners.size && topics.get(key) === topic)
    topics.delete(key)
}

export function liveWriter(chatId: string, turnId: string) {
  const key = JSON.stringify([chatId, turnId])
  let latest: LiveText | undefined
  return {
    publish(message: UIMessage) {
      const part = message.parts.length - 1
      const tail = message.parts[part]
      const botId = (message.metadata as { botId?: string } | undefined)?.botId
      if (tail?.type !== "text" || !tail.text || !botId) return
      const topic = topicFor(key)
      latest = { id: message.id, botId, part, text: tail.text }
      topic.latest = latest
      for (const send of topic.listeners) send(latest)
    },
    close() {
      const topic = topics.get(key)
      if (topic && topic.latest === latest) {
        delete topic.latest
        prune(key, topic)
      }
    },
  }
}

export function textEventResponse(
  chatId: string,
  turnId: string,
  signal: AbortSignal
) {
  const key = JSON.stringify([chatId, turnId])
  const encoder = new TextEncoder()
  let dispose: (() => void) | undefined
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const topic = topicFor(key)
      let previous: LiveText | undefined
      const send = (draft: LiveText) => {
        const continuous =
          previous?.id === draft.id &&
          previous.part === draft.part &&
          previous.text.length <= draft.text.length
        const offset = continuous ? previous!.text.length : 0
        previous = draft
        if (offset === draft.text.length) return
        const frame: TextFrame = {
          ...draft,
          offset,
          text: draft.text.slice(offset),
        }
        controller.enqueue(
          encoder.encode("data: " + JSON.stringify(frame) + "\n\n")
        )
      }
      controller.enqueue(encoder.encode(": connected\n\n"))
      topic.listeners.add(send)
      if (topic.latest) send(topic.latest)
      const heartbeat = setInterval(
        () => controller.enqueue(encoder.encode(": keepalive\n\n")),
        15000
      )
      const finish = () => {
        dispose?.()
        controller.close()
      }
      dispose = () => {
        clearInterval(heartbeat)
        topic.listeners.delete(send)
        signal.removeEventListener("abort", finish)
        prune(key, topic)
      }
      if (signal.aborted) finish()
      else signal.addEventListener("abort", finish, { once: true })
    },
    cancel() {
      dispose?.()
    },
  })
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
