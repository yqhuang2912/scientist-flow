import { CHAT_REMOTE_TURN, type ChatActivityRow } from "./chat-activity-status"
import {
  isActiveTurn,
  type ChatSnapshot,
  type ChatTurnProgress,
} from "./chat-job"

const pollInterval = 1000
const maxIdleDelay = 30_000

type ChatRefreshOptions = {
  focusTarget: EventTarget
  url: string
  activeId: string | null
  retryIdle: boolean
  refreshOnActivity?: (row: ChatActivityRow) => boolean
  canRead: () => boolean
  onSnapshot: (snapshot: ChatSnapshot) => void
  onProgress: (turn: ChatTurnProgress) => void
  onNetworkError: (notice: string | null) => void
}

export function watchChatRefresh({
  focusTarget,
  url,
  activeId,
  retryIdle,
  refreshOnActivity,
  canRead,
  onSnapshot,
  onProgress,
  onNetworkError,
}: ChatRefreshOptions) {
  const controller = new AbortController()
  const current = () => !controller.signal.aborted && canRead()
  const target = activeId ? url + "?id=" + encodeURIComponent(activeId) : url
  let timer: ReturnType<typeof setTimeout> | undefined
  let reading = false
  let idleDelay = pollInterval

  async function refresh() {
    if (reading || !current()) return
    reading = true
    clearTimeout(timer)
    try {
      const response = await fetch(target, {
        cache: "no-store",
        signal: controller.signal,
      })
      if (!current()) return
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        onNetworkError(
          `Could not refresh this conversation (HTTP ${response.status}).`
        )
        return
      }
      if (!response.ok) throw new Error("Could not refresh this conversation.")
      if (activeId) {
        const turn: ChatTurnProgress = await response.json()
        if (!current()) return
        onProgress(turn)
        if (isActiveTurn(turn.state)) timer = setTimeout(refresh, pollInterval)
      } else {
        const snapshot: ChatSnapshot = await response.json()
        if (!current()) return
        onSnapshot(snapshot)
      }
      idleDelay = pollInterval
      onNetworkError(null)
    } catch {
      if (!current()) return
      if (activeId || retryIdle) {
        timer = setTimeout(refresh, activeId ? pollInterval : idleDelay)
        idleDelay = Math.min(idleDelay * 2, maxIdleDelay)
        onNetworkError("Could not refresh this conversation. Reconnecting…")
      } else {
        onNetworkError("Could not refresh this conversation.")
      }
    } finally {
      reading = false
    }
  }

  function observed(event: Event) {
    if (refreshOnActivity?.((event as CustomEvent<ChatActivityRow>).detail)) void refresh()
  }
  if (activeId) void refresh()
  focusTarget.addEventListener("focus", refresh)
  focusTarget.addEventListener(CHAT_REMOTE_TURN, observed)
  return () => {
    controller.abort()
    clearTimeout(timer)
    focusTarget.removeEventListener("focus", refresh)
    focusTarget.removeEventListener(CHAT_REMOTE_TURN, observed)
  }
}
