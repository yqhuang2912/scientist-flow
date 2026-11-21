"use client"

import { useEffect, useRef, useState } from "react"
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
import {
  isActiveTurn,
  mergeTurnAck,
  mergeTurnProgress,
  type ChatSnapshot,
  type ChatTurnAck,
  type ChatTurnProgress,
} from "@/lib/chat-job"
import { watchChatRefresh } from "@/lib/chat-refresh"
import { CHAT_ACCEPTED_EVENT } from "@/lib/chat-recency"
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
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const uploaded = useRef(new WeakMap<File, UploadedEntry>())
  const pending = useRef<{ input: string; id: string } | null>(null)
  const version = useRef(0)
  const submitting = useRef(false)
  const url = "/api/chats/" + encodeURIComponent(chat.id) + "/messages"

  useEffect(() => {
    if (sending) return
    const epoch = version.current
    return watchChatRefresh({
      focusTarget: window,
      url,
      activeId: snapshot.activeId,
      retryIdle: chat.kind === "group",
      canRead: () =>
        epoch === version.current &&
        !submitting.current &&
        (!!snapshot.activeId || !pending.current),
      onSnapshot: setSnapshot,
      onProgress: (turn) =>
        setSnapshot((current) => mergeTurnProgress(current, turn)),
      onNetworkError: setNetworkError,
    })
  }, [chat.kind, snapshot.activeId, sending, url])

  async function submit({
    text,
    files,
    mentionedBotIds,
    workspacePaths,
  }: ChatComposerMessage) {
    if (snapshot.activeId || submitting.current)
      return { error: "A reply is already running." }
    if (files.length + workspacePaths.length > 32)
      return { error: "Select up to 32 attachments per message." }
    const botId = mentionedBotIds[0] ?? chat.bots[0]?.id
    if (!botId) return { error: "No bot is available in this chat." }
    setPendingBotId(botId)
    ++version.current
    submitting.current = true
    setNetworkError(null)
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
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500)
          pending.current = null
        return { error: await response.text() }
      }
      const ack: ChatTurnAck = await response.json()
      // A retry can acknowledge a turn that finished while disconnected.
      let final: ChatTurnProgress | undefined
      if (!isActiveTurn(ack.state)) {
        const progress = await fetch(
          url + "?id=" + encodeURIComponent(ack.turnId),
          { cache: "no-store" }
        )
        if (!progress.ok)
          throw new Error(
            "Could not load the accepted reply. Retry to recover it."
          )
        final = await progress.json()
      }
      ++version.current
      setSnapshot((current) => mergeTurnAck(current, ack, final))
      window.dispatchEvent(
        new CustomEvent(CHAT_ACCEPTED_EVENT, {
          detail: { chatId: chat.id, acceptedAt: ack.acceptedAt },
        })
      )
      pending.current = null
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "Could not submit the message.",
      }
    } finally {
      submitting.current = false
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
    } catch {
      setSnapshot((current) => ({
        ...current,
        error: "Could not stop the reply. Try again.",
      }))
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
        {networkError && (
          <p role="status" className="text-xs text-muted-foreground">
            {networkError}
          </p>
        )}
        {snapshot.error && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Response interrupted</AlertTitle>
            <AlertDescription>
              <p>{snapshot.error}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSnapshot((current) => ({ ...current, error: null }))
                }
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
