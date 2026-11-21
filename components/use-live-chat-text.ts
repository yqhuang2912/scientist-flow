"use client"
import { useEffect, useState } from "react"
import { applyTextFrame, type LiveText, type TextFrame } from "@/lib/chat-live"

const noDrafts: LiveText[] = []

export function useLiveChatText(url: string, turnId: string | null) {
  const [batch, setBatch] = useState<{ key: string; values: LiveText[] }>()
  const key = turnId && url + "?id=" + encodeURIComponent(turnId)
  useEffect(() => {
    if (!key || typeof EventSource === "undefined") return
    const source = new EventSource(key)
    const drafts = new Map<string, LiveText>()
    let paint = 0
    source.onmessage = ({ data }) => {
      const frame: TextFrame = JSON.parse(data)
      const next = applyTextFrame(drafts.get(frame.id), frame)
      if (!next) return
      drafts.set(frame.id, next)
      if (!paint)
        paint = requestAnimationFrame(() => {
          paint = 0
          setBatch({ key, values: [...drafts.values()] })
        })
    }
    return () => {
      source.close()
      cancelAnimationFrame(paint)
    }
  }, [key])
  return key && batch?.key === key ? batch.values : noDrafts
}
