import "server-only"
import type { UIMessage, UIMessageChunk } from "ai"
import { ModelConnectionError } from "./model-credentials.server"

export const nativeReplyError = (error: unknown) =>
  error instanceof ModelConnectionError
    ? error.message
    : "The local chat could not complete this reply. Check the model connection."

export function nativeReplyStream(
  signal: AbortSignal,
  generate: (signal: AbortSignal) => Promise<ReadableStream<UIMessageChunk>>,
  message: UIMessage,
  settle: (
    status: "completed" | "failed" | "cancelled",
    reply: UIMessage | null
  ) => Promise<void>
) {
  const cancelled = new AbortController()
  const active = AbortSignal.any([signal, cancelled.signal])
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      let text = ""
      let finished = false
      const emit = (chunk: UIMessageChunk) => {
        if (!cancelled.signal.aborted) controller.enqueue(chunk)
      }
      try {
        active.throwIfAborted()
        const source = await generate(active)
        const reader = source.getReader()
        try {
          for (;;) {
            const { value: chunk, done } = await reader.read()
            if (done) break
            active.throwIfAborted()
            if (chunk.type === "error")
              throw new ModelConnectionError(chunk.errorText)
            if (chunk.type === "abort")
              throw new DOMException("Reply stopped.", "AbortError")
            if (chunk.type === "finish") {
              finished = true
              break
            }
            if (chunk.type === "text-delta") text += chunk.delta
            emit(chunk)
          }
        } finally {
          await reader.cancel()
          reader.releaseLock()
        }
        active.throwIfAborted()
        if (!finished || !text.trim())
          throw new ModelConnectionError(
            "The model returned an incomplete reply."
          )
        await settle("completed", {
          ...message,
          parts: [{ type: "text", text, state: "done" }],
        })
        emit({ type: "finish" })
      } catch (error) {
        const stopped =
          active.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        try {
          await settle(stopped ? "cancelled" : "failed", null)
        } catch {
          emit({
            type: "error",
            errorText: "Could not save the state of this reply.",
          })
          return
        }
        emit(
          stopped
            ? { type: "abort" }
            : { type: "error", errorText: nativeReplyError(error) }
        )
      } finally {
        if (!cancelled.signal.aborted) controller.close()
      }
    },
    cancel(reason) {
      cancelled.abort(reason)
    },
  })
}
