"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { nanoid } from "nanoid"
import { CircleAlertIcon } from "lucide-react"
import { CHAT_ACTIVITY_CHANGED } from "@/lib/chat-activity-status"
import { withLiveText, type WorkingStep } from "@/lib/chat-live"
import { useLiveChatText } from "./use-live-chat-text"
import { WorkflowCheckpointPanel } from "./workflow-checkpoint"
import {
  checkpointTranscript,
  initialCheckpoint,
  checkpointCommand,
  type CheckpointCommand,
  type WorkflowCheckpoint,
} from "@/lib/workflow-checkpoint"
import type { ReviseMessage } from "@/lib/chat-revision"
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
  mergeCheckpoint,
  mergeTurnProgress,
  type ChatSnapshot,
  type ChatTurnAck,
  type ChatTurnProgress,
} from "@/lib/chat-job"
import { watchChatRefresh } from "@/lib/chat-refresh"
import {
  CHAT_ACCEPTED_EVENT,
  type ChatAcceptedDetail,
} from "@/lib/chat-recency"
import type { UploadedEntry } from "@/lib/workspace-validation"
import type { ChatWithBot } from "@/queries/chats"

const listenReservation = (notify: () => void) => {
  window.addEventListener("workflow-reservation", notify)
  return () => window.removeEventListener("workflow-reservation", notify)
}

export function ChatInterface({
  chat,
  initial,
}: {
  chat: ChatWithBot
  initial: ChatSnapshot
}) {
  const [snapshot, setSnapshot] = useState(initial)
  const url = "/api/chats/" + encodeURIComponent(chat.id) + "/messages"
  const active = snapshot.messages.find(m => m.id === snapshot.activeId && m.role === "user")
  const activity = active?.metadata as { workingStep?: WorkingStep; workflow?: unknown; checkpoint?: WorkflowCheckpoint } | undefined
  const waiting = activity?.checkpoint?.phase === "waiting"
  useEffect(() => {
    window.dispatchEvent(new Event(CHAT_ACTIVITY_CHANGED))
  }, [chat.id, snapshot.activeId, waiting])
  const working = activity?.workingStep
  const live = useLiveChatText(url, waiting ? null : snapshot.activeId)
  const transcript = useMemo(() => {
    const durable = working?.draft ? [{ id: working.messageId, botId: working.botId, part: 0, text: working.draft }] : []
    return checkpointTranscript(withLiveText(snapshot.messages, [...durable, ...live]))
  }, [snapshot.messages, working, live])
  const [pendingBotId, setPendingBotId] = useState(chat.bots[0]?.id ?? "")
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [pendingRevisionId, setPendingRevisionId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [workflowRetryAvailable, setWorkflowRetryAvailable] = useState(false)
  const reservationKey = chat.template
    ? "workflow-reservation/" + chat.id + "/" + chat.template.id
    : null
  const reservation = useSyncExternalStore(
    listenReservation,
    () => {
      try {
        return reservationKey && sessionStorage.getItem(reservationKey)
      } catch {
        return null
      }
    },
    () => null
  )
  let initialCommand: CheckpointCommand | undefined
  if (reservation) {
    try {
      initialCommand = checkpointCommand.safeParse(JSON.parse(reservation)).data
    } catch {
      /* Ignore invalid session data. */
    }
  }
  const [changingCheckpoint, setChangingCheckpoint] = useState(false)
  const [checkpointError, setCheckpointError] = useState("")
  const chatDropArea = useRef<HTMLDivElement>(null)
  const uploaded = useRef(new WeakMap<File, UploadedEntry>())
  const pending = useRef<{ input: string; id: string } | null>(null)
  const version = useRef(0)
  const submitting = useRef(false)
  const savingVersion = useRef<Promise<void> | null>(null)
  const [selectingVersion, setSelectingVersion] = useState(false)
  const lastKnownTurn = snapshot.messages.findLast(m => m.role === "user")?.id
  useEffect(() => {
    if (sending || selectingVersion) return
    const epoch = version.current
    return watchChatRefresh({
      refreshOnActivity: row => row.chatId === chat.id && !snapshot.activeId && (isActiveTurn(row.state) || row.turnId !== lastKnownTurn),
      focusTarget: window,
      url,
      activeId: snapshot.activeId,
      retryIdle: chat.kind === "group",
      canRead: () =>
        epoch === version.current &&
        !submitting.current &&
        !savingVersion.current &&
        (!!snapshot.activeId || !pending.current),
      onSnapshot: setSnapshot,
      onProgress: (turn) =>
        setSnapshot((current) => mergeTurnProgress(current, turn)),
      onNetworkError: setNetworkError,
    })
  }, [chat.id, chat.kind, snapshot.activeId, sending, selectingVersion, url, lastKnownTurn])

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
      await savingVersion.current
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
      await acceptResponse(response)
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

  const acceptResponse = useCallback(
    async (response: Response) => {
      const ack: ChatTurnAck = await response.json()
      window.dispatchEvent(
        new CustomEvent<ChatAcceptedDetail>(CHAT_ACCEPTED_EVENT, {
          detail: {
            chatId: chat.id,
            acceptedAt: ack.acceptedAt,
            lastMessagePreview: ack.lastMessagePreview,
          },
        })
      )
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
    },
    [chat.id, url]
  )

  const revise = useCallback<ReviseMessage>(
    async (source, revision) => {
      if (snapshot.activeId || submitting.current)
        return { error: "A reply is already running." }
      submitting.current = true
      ++version.current
      setPendingRevisionId(revision.action === "retry" ? revision.replyId : source.id)
      const sourceBot = (source.metadata as { botId?: string } | undefined)
        ?.botId
      setPendingBotId(
        (revision.action === "edit" && revision.mentionedBotIds[0]) ||
          sourceBot ||
          chat.bots[0]?.id ||
          ""
      )
      setSending(true)
      setNetworkError(null)
      try {
        await savingVersion.current
        const response = await fetch(
          url + "?id=" + encodeURIComponent(source.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(revision),
          }
        )
        if (!response.ok) throw new Error(await response.text())
        await acceptResponse(response)
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "Could not resend the message.",
        }
      } finally {
        submitting.current = false
        setSending(false)
        setPendingRevisionId(null)
      }
    },
    [snapshot.activeId, chat.bots, url, acceptResponse]
  )

  const chooseVersion = useCallback(
    async (attemptId: string, versionId: string) => {
      if (savingVersion.current || submitting.current)
        throw new Error("Another change is in progress.")
      setSelectingVersion(true)
      const save = async () => {
        const response = await fetch(
          url + "?id=" + encodeURIComponent(attemptId),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ versionId }),
          }
        )
        if (!response.ok) throw new Error(await response.text())
        setSnapshot((current) => ({
          ...current,
          messages: current.messages.map((message) =>
            message.id === attemptId
              ? {
                  ...message,
                  metadata: {
                    ...(message.metadata as object),
                    replyChoice: versionId,
                  },
                }
              : message
          ),
        }))
      }
      savingVersion.current = save()
      try {
        await savingVersion.current
      } finally {
        savingVersion.current = null
        setSelectingVersion(false)
      }
    },
    [url]
  )

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
  const workflowId = chat.template && "workflow_" + chat.template.id
  const workflowMessage = snapshot.messages.find((m) => m.id === workflowId)
  const knownWorkflow = !!workflowMessage
  const checkpoint = knownWorkflow
    ? (workflowMessage.metadata as { checkpoint?: WorkflowCheckpoint })
        ?.checkpoint
    : initialCheckpoint(initialCommand)
  const workflowUrl = "/api/chats/" + encodeURIComponent(chat.id) + "/workflow"
  async function changeGate(command: CheckpointCommand) {
    if (!knownWorkflow && reservationKey) {
      try {
        if (command.action === "continue")
          sessionStorage.removeItem(reservationKey)
        else sessionStorage.setItem(reservationKey, JSON.stringify(command))
        window.dispatchEvent(new Event("workflow-reservation"))
        setCheckpointError("")
        return true
      } catch {
        setCheckpointError("Could not save this reservation in this tab.")
        return false
      }
    }
    setChangingCheckpoint(true)
    setCheckpointError("")
    try {
      const response = await fetch(workflowUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      })
      if (!response.ok) throw new Error(await response.text())
      const saved: WorkflowCheckpoint = await response.json()
      setSnapshot((current) => ({
        ...current,
        messages: current.messages.map((m) =>
          m.id === workflowId ? mergeCheckpoint(m, saved) : m
        ),
      }))
      setNetworkError(null)
      return true
    } catch (error) {
      setCheckpointError(
        error instanceof Error
          ? error.message
          : "Could not update the checkpoint."
      )
      return false
    } finally {
      setChangingCheckpoint(false)
    }
  }
  const retryWorkflow =
    workflowRetryAvailable ||
    (!!snapshot.error?.includes("HTTP 429") &&
      snapshot.messages.findLast((m) => m.role === "user")?.id === workflowId)
  async function openWorkflow() {
    if (submitting.current) return
    submitting.current = true
    ++version.current
    setSending(true)
    setNetworkError(null)
    try {
      const response = await fetch(
        workflowUrl + (retryWorkflow ? "?retry=rate-limit" : ""),
        {
          method: "POST",
          ...(initialCommand &&
            !knownWorkflow && {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(initialCommand),
            }),
        }
      )
      if (!response.ok) throw new Error(await response.text())
      const receipt: ChatTurnAck & { retryable?: boolean } =
        await response.json()
      if (reservationKey) {
        try {
          sessionStorage.removeItem(reservationKey)
        } catch {
          /* The accepted turn owns the reservation. */
        }
      }
      setWorkflowRetryAvailable(!!receipt.retryable)
      setPendingBotId((receipt.userMessage.metadata as { botId: string }).botId)
      const progress = await fetch(
        url + "?id=" + encodeURIComponent(receipt.turnId),
        { cache: "no-store" }
      )
      if (!progress.ok)
        throw new Error(
          "Could not load the workflow run. Open it again to recover."
        )
      const turn: ChatTurnProgress = await progress.json()
      setSnapshot((current) => {
        if (current.messages.some((m) => m.id === receipt.turnId))
          return mergeTurnProgress(
            { ...current, activeId: receipt.turnId },
            turn
          )
        return mergeTurnAck(current, receipt, turn)
      })
      if (knownWorkflow)
        document
          .querySelector('[data-evidence-message="' + receipt.turnId + '"]')
          ?.scrollIntoView({ block: "start" })
      else
        window.dispatchEvent(
          new CustomEvent<ChatAcceptedDetail>(CHAT_ACCEPTED_EVENT, {
            detail: {
              chatId: chat.id,
              acceptedAt: receipt.acceptedAt,
              lastMessagePreview: receipt.lastMessagePreview,
            },
          })
        )
    } catch (error) {
      setNetworkError(
        error instanceof Error
          ? error.message
          : "Could not open the workflow run."
      )
    } finally {
      submitting.current = false
      setSending(false)
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
      ref={chatDropArea}
      data-project-chat={isGroup ? chat.id : undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ChatTranscript
        key={chat.id}
        directChatId={!isGroup ? chat.id : undefined}
        messages={transcript}
        bots={chat.bots}
        isGroup={isGroup}
        status={
          checkpoint?.phase === "waiting" && snapshot.activeId === workflowId
            ? "ready"
            : status
        }
        onRevise={revise}
        chooseVersion={chooseVersion}
        revisionBusy={sending || selectingVersion || !!snapshot.activeId}
        pendingRevisionId={pendingRevisionId}
        pendingBotId={working?.botId ?? pendingBotId}
        workingMessageId={waiting ? undefined : working?.messageId}
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pb-3 sm:px-6">
        {chat.template && (
          <div className="grid gap-2 rounded-lg border px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span>
                {chat.template.name} · v{chat.template.version}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={sending || !!snapshot.activeId}
                onClick={openWorkflow}
              >
                {workflowId && snapshot.activeId === workflowId
                  ? checkpoint?.phase === "waiting"
                    ? "Paused"
                    : "Running"
                  : retryWorkflow
                    ? "Retry rate-limited step"
                    : knownWorkflow
                      ? "View workflow run"
                      : "Start workflow"}
              </Button>
            </div>
            {activity?.workflow != null && (
              <p role="status" className="break-words text-sm font-medium" aria-live="polite">
                {waiting ? "等待人工介入 · 子集实验已完成"
                  : working ? `第 ${working.stage} / 2 步 · ${chat.bots.find(bot => bot.id === working.botId)?.name ?? "Bot"} · ${working.title}`
                    : "正在准备下一步…"}
              </p>
            )}
            {checkpoint && (
              <WorkflowCheckpointPanel
                bots={chat.bots}
                key={chat.id}
                checkpoint={checkpoint}
                disabled={
                  sending ||
                  changingCheckpoint ||
                  (knownWorkflow && snapshot.activeId !== workflowId)
                }
                beforeStart={!knownWorkflow}
                currentStage={waiting || working?.supplement ? "checkpoint" : working?.stage === 1 ? "experiment" : working?.stage === 2 ? "review" : undefined}
                reviewed={snapshot.messages.some((message) => {
                  const meta = message.metadata as
                    | { workflowStep?: number; userMessageId?: string }
                    | undefined
                  return (
                    meta?.workflowStep === 2 &&
                    meta.userMessageId === workflowId
                  )
                })}
                change={changeGate}
              />
            )}
            {checkpointError && (
              <p role="alert" className="text-sm text-destructive">
                {checkpointError}
              </p>
            )}
          </div>
        )}
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
          dropArea={chatDropArea}
          onSubmit={submit}
          status={status}
          onStop={stop}
        />
      </div>
    </div>
  )
}
