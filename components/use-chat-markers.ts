"use client"
import { useEffect, useRef, useState } from "react"
import { CHAT_ACCEPTED_EVENT } from "@/lib/chat-recency"
import {
  CHAT_ACTIVITY_CHANGED,
  CHAT_REMOTE_TURN,
  chatMarker,
  type ChatActivityRow,
  type ChatMarker,
} from "@/lib/chat-activity-status"

const prefix = "scientistflow:chat-read:"
const seededKey = prefix + "initialized"
const memory = new Map<string, string>()
function read(key: string) {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null
  } catch {
    return memory.get(key) ?? null
  }
}
function remember(key: string, value: string) {
  memory.set(key, value)
  try {
    localStorage.setItem(key, value)
  } catch {
    /* This tab still tracks read receipts. */
  }
}

export function useChatMarkers(pathname: string) {
  const [markers, setMarkers] = useState<Record<string, ChatMarker>>({})
  const latest = useRef<ChatActivityRow[]>([])
  useEffect(() => {
    const controller = new AbortController()
    let rows = latest.current
    let timer: ReturnType<typeof setTimeout>
    let fetching = false
    let again = false
    function render(markRead = true) {
      const next: Record<string, ChatMarker> = {}
      for (const row of rows) {
        const key = prefix + row.chatId
        let seen = read(key)
        if (
          !document.hidden &&
          pathname === "/chats/" + row.chatId &&
          row.state === "completed" &&
          seen !== row.turnId
        ) {
          seen = row.turnId
          if (markRead) remember(key, seen)
        }
        const marker = chatMarker(row, seen)
        if (marker) next[row.chatId] = marker
      }
      setMarkers(next)
    }
    function syncRead(event: StorageEvent) {
      if (!event.key || event.key.startsWith(prefix)) render(false)
    }
    async function refresh() {
      clearTimeout(timer)
      if (document.hidden || controller.signal.aborted) return
      if (fetching) {
        again = true
        return
      }
      fetching = true
      try {
        const response = await fetch("/api/chats/activity", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) return
        const updated: ChatActivityRow[] = await response.json()
        if (controller.signal.aborted) return
        const selected = updated.find(
          (row) => pathname === "/chats/" + row.chatId
        )
        const previous =
          selected && rows.find((row) => row.chatId === selected.chatId)
        if (
          selected &&
          (previous?.turnId !== selected.turnId ||
            previous.state !== selected.state)
        )
          window.dispatchEvent(
            new CustomEvent(CHAT_REMOTE_TURN, { detail: selected })
          )
        rows = updated
        latest.current = updated
        if (!read(seededKey)) {
          for (const row of rows)
            if (row.state === "completed")
              remember(prefix + row.chatId, row.turnId)
          remember(seededKey, "1")
        }
        render()
      } catch {
        /* Keep the last known status until the next successful read. */
      } finally {
        fetching = false
        if (!controller.signal.aborted && !document.hidden) {
          const busy = rows.some(
            (row) => row.state === "queued" || row.state === "running"
          )
          timer = setTimeout(refresh, again ? 0 : busy ? 2000 : 10000)
          again = false
        }
      }
    }
    render()
    void refresh()
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("focus", refresh)
    window.addEventListener(CHAT_ACCEPTED_EVENT, refresh)
    window.addEventListener(CHAT_ACTIVITY_CHANGED, refresh)
    window.addEventListener("storage", syncRead)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("focus", refresh)
      window.removeEventListener(CHAT_ACCEPTED_EVENT, refresh)
      window.removeEventListener(CHAT_ACTIVITY_CHANGED, refresh)
      window.removeEventListener("storage", syncRead)
    }
  }, [pathname])
  return markers
}
