"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { nanoid } from "nanoid"
import { CircleAlertIcon } from "lucide-react"
import { ChatTranscript } from "./chat-transcript"
import { ChatComposer } from "./chat-composer"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Button } from "./ui/button"
import {
  attachmentMediaType,
  type ChatComposerMessage,
} from "@/lib/chat-composer"
import { CHAT_UPLOAD_EVENT, uploadFiles } from "@/lib/workspace-upload-client"
import type { ChatSnapshot, ChatTurnProgress } from "@/lib/chat-job"
import type { UploadedEntry } from "@/lib/workspace-validation"
import type { ChatWithBot } from "@/queries/chats"

export function ChatInterface({
  chat,
  initial,
}: {
  chat: ChatWithBot
  initial: ChatSnapshot
}) {
  const [snapshot, setSnapshot] = useState(initial)
  const [pendingBotId, setPendingBotId] = useState(chat.bots[0]?.id ?? "")
  const [error, setError] = useState<string | null>(initial.error)
  const [sending, setSending] = useState(false)
  const uploaded = useRef(new WeakMap<File, UploadedEntry>())
  const pending = useRef<{ input: string; id: string } | null>(null)
  const version = useRef(0)
  const router = useRouter()
  const url = "/api/chats/" + encodeURIComponent(chat.id) + "/messages"

  // Poll only while a turn runs. Focusing a second tab also refreshes its view.
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let reading = false
    async function refresh() {
      if (reading) return
      reading = true
      const revision = version.current
      try {
        const activeId = snapshot.activeId
        if (activeId) {
          const response = await fetch(
            url + "?id=" + encodeURIComponent(activeId),
            {
              signal: controller.signal,
              cache: "no-store",
            }
          )
          if (!response.ok) throw new Error("Could not refresh this reply.")
          const turn: ChatTurnProgress = await response.json()
          if (controller.signal.aborted || version.current !== revision) return
          if (turn.state === "running" || turn.state === "queued") {
            setSnapshot((current) => {
              const index = current.messages.findIndex(
                (m) => m.id === activeId && m.role === "user"
              )
              if (index < 0 || current.activeId !== activeId) return current
              return {
                ...current,
                messages: [
                  ...current.messages.slice(0, index + 1),
                  ...turn.replies,
                ],
              }
            })
            setError(null)
            return
          }
        }
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        })
        if (!response.ok)
          throw new Error("Could not refresh this conversation.")
        const next: ChatSnapshot = await response.json()
        if (!controller.signal.aborted && revision === version.current) {
          setSnapshot(next)
          setError(next.error)
        }
      } catch {
        if (!controller.signal.aborted && revision === version.current)
          setError("Could not refresh this conversation. Reconnecting…")
      } finally {
        reading = false
        if (!controller.signal.aborted && snapshot.activeId) {
          clearTimeout(timer)
          timer = setTimeout(refresh, 1000)
        }
      }
    }
    if (snapshot.activeId) void refresh()
    window.addEventListener("focus", refresh)
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [snapshot.activeId, url])

  async function submit({
    text,
    files,
    mentionedBotIds,
    workspacePaths,
  }: ChatComposerMessage) {
    if (snapshot.activeId || sending)
      return { error: "A reply is already running." }
    if (files.length + workspacePaths.length > 32)
      return { error: "Select up to 32 attachments per message." }
    const botId = mentionedBotIds[0] ?? chat.bots[0]?.id
    if (!botId) return { error: "No bot is available in this chat." }
    setPendingBotId(botId)
    ++version.current
    setSending(true)
    try {
      const entries: UploadedEntry[] = []
      await uploadFiles(
        { chatId: chat.id, attachment: true },
        files,
        (entry) => {
          entries.push(entry)
          window.dispatchEvent(
            new CustomEvent(CHAT_UPLOAD_EVENT, { detail: chat.id })
          )
        },
        uploaded.current
      )
      const input = {
        botId,
        ...(mentionedBotIds.length && { mentionedBotIds }),
        ...(workspacePaths.length && { workspacePaths }),
        text,
        files: entries.map((e, i) => ({
          name: files[i].name,
          relativePath: e.relPath,
          size: e.size,
          mediaType: attachmentMediaType(files[i])!,
        })),
      }
      const signature = JSON.stringify(input)
      if (pending.current?.input !== signature)
        pending.current = { id: nanoid(), input: signature }
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pending.current.id, ...input }),
      })
      if (!response.ok) return { error: await response.text() }
      const next: ChatSnapshot = await response.json()
      ++version.current
      setSnapshot(next)
      setError(next.error)
      pending.current = null
      router.refresh()
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Could not submit the message.",
      }
    } finally {
      setSending(false)
    }
  }

  async function stop() {
    if (!snapshot.activeId) return
    try {
      const response = await fetch(
        url + "?id=" + encodeURIComponent(snapshot.activeId),
        { method: "DELETE" }
      )
      if (!response.ok) throw new Error("Could not stop the reply.")
      const next: ChatSnapshot = await response.json()
      ++version.current
      setSnapshot(next)
    } catch {
      setError("Could not stop the reply. Try again.")
    }
  }
  const status = sending
    ? "submitted"
    : snapshot.activeId
      ? "streaming"
      : "ready"
  const isGroup = chat.kind === "group"
  return (
    <div
      data-project-chat={isGroup ? chat.id : undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ChatTranscript
        key={chat.id}
        directChatId={!isGroup ? chat.id : undefined}
        messages={snapshot.messages}
        bots={chat.bots}
        isGroup={isGroup}
        status={status}
        pendingBotId={pendingBotId}
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pb-3 sm:px-6">
        {error && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Response interrupted</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setError(null)}
              >
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <ChatComposer
          bots={chat.bots}
          chatId={chat.id}
          onSubmit={submit}
          status={status}
          onStop={stop}
        />
      </div>
    </div>
  )
}
