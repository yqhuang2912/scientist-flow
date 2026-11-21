"use client"
import { toolCallAnchor } from "@/lib/project-decisions"

import { memo, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useWorkspaceDocument } from "./workspace-document-provider"
import { Button } from "./ui/button"
import {
  SaveMemoryDialog,
  type MemoryDraft,
} from "@/components/bot-memory-dialog"
import { isToolUIPart, type ChatStatus, type UIMessage } from "ai"
import { BotIcon, MessageCircleIcon, UserRoundIcon } from "lucide-react"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Trace } from "@/components/ui/trace"
import { Spinner } from "@/components/ui/spinner"
import { mentionPattern } from "@/lib/chat-mentions"
import { ChatMention, ChatMarkdown } from "@/components/chat-markdown"
import { ChatMessageActions } from "@/components/chat-message-actions"
import { ChatMessageEditor } from "@/components/chat-message-editor"
import { toast } from "@/components/ui/toast"
import { chatTurnGroups, projectReplyVersions, retryTarget, SHOW_REPLY_EVIDENCE, type ReplyVersions, type ReviseMessage } from "@/lib/chat-revision"
import { BotName } from "@/components/bot-name"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  ChatActivity,
  GroupToolActivity,
  ChatApproval,
  ChatFile,
  type RespondToApproval,
} from "@/components/chat-activity"
import { messageAttachmentSchema } from "@/lib/chat-composer"
import { cleanBotText } from "@/lib/chat-bot-text"
import { cn } from "@/lib/utils"
import { groupActivities } from "@/lib/group-chat-activity"
import {
  getAssistantSegments,
  getHandoff,
  getMessageBotId,
  groupChatParts,
  type ChatSpeaker,
  type IndexedChatPart,
} from "@/lib/chat-presentation"

function WorkflowEvidence({ message }: { message: UIMessage }) {
  const { chatId } = useParams<{ chatId: string }>()
  const { open } = useWorkspaceDocument()
  const meta = message.metadata as { workflowStep?: number; nodeTitle?: string; version?: number; artifact?: { evidence: string; path: string; sha256: string } } | undefined
  if (!meta?.workflowStep || !meta.artifact) return null
  const artifact = meta.artifact
  return <details className="rounded-md border px-3 py-2 text-sm">
    <summary className="cursor-pointer">Step {meta.workflowStep}{meta.nodeTitle && " · " + meta.nodeTitle} · v{meta.version} · {meta.workflowStep === 1 ? "Experiment evidence" : "Verification evidence"}</summary>
    <div className="mt-3 flex flex-col items-start gap-3">
      <ChatMarkdown>{artifact.evidence}</ChatMarkdown>
      <p className="break-all text-xs text-muted-foreground">Report SHA-256 · {artifact.sha256}</p>
      <Button variant="outline" size="sm" onClick={() => void open({ chatId, relativePath: artifact.path })}>Open {artifact.path}</Button>
    </div>
  </details>
}

function SpeakerAvatar({
  bot,
  user = false,
}: {
  bot?: ChatSpeaker
  user?: boolean
}) {
  return (
    <MessageAvatar>
      {bot ? (
        <ChatAvatar seed={bot.avatar} animated alt={`${bot.name} avatar`} />
      ) : (
        <Avatar
          className="size-7"
          role="img"
          aria-label={user ? "User avatar" : "Assistant avatar"}
        >
          <AvatarFallback>
            {user ? (
              <UserRoundIcon aria-hidden className="size-4" />
            ) : (
              <BotIcon aria-hidden className="size-4" />
            )}
          </AvatarFallback>
        </Avatar>
      )}
    </MessageAvatar>
  )
}

function AssistantHeader({
  bot,
  name,
  waitingForText,
}: {
  bot?: ChatSpeaker
  name: string
  waitingForText: boolean
}) {
  return (
    <MessageHeader>
      <SpeakerAvatar bot={bot} />
      <BotName name={name} job={bot?.job} />
      {waitingForText && (
        <Spinner
          aria-label="Waiting for reply"
          className="shrink-0 text-muted-foreground motion-reduce:animate-none"
        />
      )}
    </MessageHeader>
  )
}

function AssistantParts({
  message,
  speaker,
  parts,
  streaming,
  busy,
  onApproval,
}: {
  message: UIMessage
  speaker?: { name: string; id: string | null }
  parts: IndexedChatPart[]
  streaming: boolean
  busy: boolean
  onApproval?: RespondToApproval
}) {
  const blocks = groupChatParts(parts, !!speaker)
  const activities =
    speaker &&
    groupActivities(message, parts, speaker.name, speaker.id, streaming)
  return (
    // Match the visible avatar/copy glyphs, which sit inside their hit boxes.
    <div className="flex min-w-0 flex-wrap items-start gap-x-1.5 gap-y-3 pl-1 [&>:not([data-slot=attachment])]:basis-full">
      {blocks.map((block) => {
        if (block.kind === "activity")
          return (
            <Trace key={block.key}>
              {block.parts.map(({ part, index }) =>
                isToolUIPart(part) ? (
                  <div key={part.toolCallId}>
                    {activities ? (
                      <GroupToolActivity
                        summary={activities.get(part.toolCallId)!}
                        toolAnchor={toolCallAnchor(message.id, part.toolCallId)}
                        approval={
                          part.state === "approval-requested" ? part : undefined
                        }
                        disabled={busy}
                        onRespond={onApproval}
                      />
                    ) : (
                      <ChatActivity
                        part={part}
                        active={streaming}
                        toolAnchor={toolCallAnchor(message.id, part.toolCallId)}
                      />
                    )}
                  </div>
                ) : (
                  <ChatActivity key={index} part={part} active={streaming} />
                )
              )}
            </Trace>
          )
        if (block.kind === "approval" && isToolUIPart(block.part))
          return (
            <ChatApproval
              key={block.part.toolCallId}
              part={block.part}
              disabled={busy}
              onRespond={onApproval}
            />
          )
        if (block.part.type === "text")
          return (
            <div
              key={block.key}
              data-evidence-part={block.key}
              tabIndex={-1}
              className="rounded-sm focus-visible:outline-ring"
            >
              <ChatMarkdown
                isAnimating={streaming && block.part.state === "streaming"}
              >
                {block.part.text}
              </ChatMarkdown>
            </div>
          )
        if (block.part.type === "file")
          return <ChatFile key={block.key} part={block.part} />
        return null
      })}
    </div>
  )
}

const ChatTurn = memo(function ChatTurn({
  message,
  bots,
  isGroup,
  streaming,
  busy,
  onRemember,
  onRevise,
  versions,
  chooseVersion,
  revisionBusy,
  onApproval,
}: {
  message: UIMessage
  bots: ChatSpeaker[]
  isGroup: boolean
  streaming: boolean
  busy: boolean
  onRemember?: (draft: MemoryDraft) => void
  onRevise?: ReviseMessage
  versions?: ReplyVersions
  chooseVersion?: (attemptId: string, versionId: string) => Promise<void>
  revisionBusy?: boolean
  onApproval?: RespondToApproval
}) {
  const [editing, setEditing] = useState(false)
  const [choosing, setChoosing] = useState(false)
  if (message.role === "system") return null
  if (message.role === "user") {
    const metadata = message.metadata as
      | { checkpointNote?: boolean; mentionedBotIds?: string[]; workspaceFiles?: Record<string, unknown> }
      | undefined
    const mentionedIds = metadata?.mentionedBotIds
    const mentionedBotNames = bots
      .filter((bot) => mentionedIds?.includes(bot.id))
      .map((bot) => bot.name)
    const recipient = isGroup ? bots.find(bot => bot.id === getMessageBotId(message)) : undefined
    const inlineRecipient = metadata?.checkpointNote && recipient && message.parts.some(
      p => p.type === "text" && mentionPattern([recipient.name]).test(p.text)
    )
    const addressedBot = !inlineRecipient && (metadata?.checkpointNote || !mentionedIds?.length) ? recipient : undefined
    const paths = metadata?.workspaceFiles
    const saved = message.parts.map(
      (_, index) => messageAttachmentSchema.safeParse(paths?.[index]).data
    )
    const mentionLabels = [
      ...new Set([...mentionedBotNames, ...(inlineRecipient && recipient ? [recipient.name] : [])]),
      ...saved.flatMap((ref) =>
        ref && "origin" in ref && !ref.contextOnly ? [ref.relativePath] : []
      ),
    ]
    const body = message.parts.flatMap((part, index) =>
      part.type === "text" && !saved[index] ? [{ part, index }] : []
    )
    const text = body.map(({ part }) => part.text).join("\n\n")
    const attachments = message.parts.flatMap((part, index) => {
      const ref = saved[index]
      if (ref?.contextOnly) return []
      const file =
        part.type === "file"
          ? part
          : ref && part.type === "text"
            ? {
                type: "file" as const,
                filename: ref.name,
                mediaType: ref.mediaType,
                url: "",
              }
            : undefined
      if (!file) return []
      return [
        <ChatFile
          key={index}
          part={ref && "origin" in ref ? { ...file, filename: ref.name } : file}
          referenceSize={ref?.size}
          mentionedPath={ref && "origin" in ref ? ref.relativePath : undefined}
          savedPath={
            ref?.relativePath ??
            paths?.[index] ??
            ("workspacePath" in file ? file.workspacePath : undefined)
          }
        />,
      ]
    })
    return (
      <Message align="end">
        <MessageContent className="gap-2">
          <MessageHeader>
            You
            <SpeakerAvatar user />
          </MessageHeader>
          {editing && onRevise ? (
            <>
              {attachments.length > 0 && <div className="flex flex-wrap gap-2">{attachments}</div>}
              <ChatMessageEditor message={message} text={text} bots={bots} hasFiles={attachments.length > 0}
                disabled={!!revisionBusy} revise={onRevise} close={() => setEditing(false)} />
            </>
          ) : <Bubble
            align="end"
            variant="muted"
            className="max-w-full sm:max-w-[85%]"
          >
            <BubbleContent>
              <div className="flex min-w-0 flex-col gap-2">
                {attachments.length > 0 && (
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {attachments}
                  </div>
                )}
                {body.map(({ part, index }, position) => (
                  <div
                    key={index}
                    data-evidence-part={index}
                    tabIndex={-1}
                    className="min-w-0 rounded-sm focus-visible:outline-ring"
                  >
                    {addressedBot && position === 0 && (
                      <ChatMention className="me-2.5">
                        {addressedBot.name}
                      </ChatMention>
                    )}
                    <ChatMarkdown
                      variant="user"
                      mentionLabels={mentionLabels}
                      className={cn(
                        "min-w-0",
                        addressedBot &&
                          position === 0 &&
                          "inline [&>p:first-child]:inline [&>p:first-child+*]:mt-4"
                      )}
                    >
                      {part.text}
                    </ChatMarkdown>
                  </div>
                ))}
              </div>
            </BubbleContent>
          </Bubble>}
          {!editing && <ChatMessageActions
            text={text}
            disabled={revisionBusy}
            edit={onRevise && (() => setEditing(true))}
            remember={
              onRemember && bots[0]
                ? {
                    label: "Remember with " + bots[0].name,
                    open: () => onRemember({ messageId: message.id, text }),
                  }
                : undefined
            }
          />}
        </MessageContent>
      </Message>
    )
  }

  const handoff = message.parts.map(getHandoff).find(Boolean)
  const segments = getAssistantSegments(
    message,
    isGroup ? null : (bots[0]?.id ?? null),
    streaming
  )
  return (
    <MessageGroup className="gap-5">
      {segments.map((segment, index) => {
        if (
          isGroup &&
          !streaming &&
          segment.parts.every(
            ({ part }) =>
              part.type === "step-start" || part.type === "reasoning"
          )
        )
          return null
        const bot = bots.find((candidate) => candidate.id === segment.botId)
        const pastName =
          handoff && segment.botId === handoff.sourceId
            ? handoff.sourceName
            : handoff && segment.botId === handoff.targetId
              ? handoff.targetName
              : null
        const name = bot?.name ?? pastName ?? "Assistant"
        const parts = segment.parts.map(({ part, index }) => ({
          index,
          part: part.type === "text"
            ? { ...part, text: cleanBotText(part.text, bots, streaming) }
            : part,
        }))
        const waitingForText = streaming && index === segments.length - 1 &&
          !parts.some(({ part }) => part.type === "text" && /\S/.test(part.text))
        return (
          <Message key={versions && segments.length === 1 ? versions.replies[0].id : segment.key}>
            <MessageContent className="gap-2">
              <AssistantHeader
                bot={bot}
                name={name}
                waitingForText={waitingForText}
              />
              <AssistantParts
                message={message}
                speaker={isGroup ? { id: segment.botId, name } : undefined}
                parts={parts}
                streaming={streaming}
                busy={busy}
                onApproval={onApproval}
              />
              {!!(message.metadata as { workflowStep?: number } | undefined)
                ?.workflowStep && <WorkflowEvidence message={message} />}
              {!streaming && (
                <ChatMessageActions
                  disabled={revisionBusy || choosing}
                  retry={
                    versions && onRevise && index === segments.length - 1
                      ? async () => {
                          const result = await onRevise(versions.user, {
                            action: "retry",
                            replyId: versions.replies[0].id,
                            after: versions.lastAttempt,
                          })
                          if (result?.error)
                            toast.add({ type: "error", title: result.error })
                        }
                      : undefined
                  }
                  versions={
                    index === segments.length - 1 ? versions : undefined
                  }
                  choose={
                    chooseVersion && versions?.lastAttempt
                      ? async (id) => {
                          if (id === message.id) return
                          setChoosing(true)
                          try {
                            await chooseVersion(versions.lastAttempt!, id)
                          } catch (error) {
                            toast.add({
                              type: "error",
                              title:
                                error instanceof Error
                                  ? error.message
                                  : "Could not select reply version.",
                            })
                          } finally {
                            setChoosing(false)
                          }
                        }
                      : undefined
                  }
                  text={parts
                    .map(({ part }) => (part.type === "text" ? part.text : ""))
                    .filter(Boolean)
                    .join("\n\n")}
                />
              )}
            </MessageContent>
          </Message>
        )
      })}
    </MessageGroup>
  )
})

export function ChatTranscript({
  directChatId,
  messages,
  bots,
  isGroup,
  status,
  pendingBotId,
  workingMessageId,
  pendingRevisionId,
  onRevise,
  chooseVersion,
  revisionBusy,
  onApproval,
}: {
  directChatId?: string
  messages: UIMessage[]
  bots: ChatSpeaker[]
  isGroup: boolean
  status: ChatStatus
  pendingBotId?: string
  workingMessageId?: string
  pendingRevisionId?: string | null
  onRevise?: ReviseMessage
  chooseVersion?: (attemptId: string, versionId: string) => Promise<void>
  revisionBusy?: boolean
  onApproval?: RespondToApproval
}) {
  const [draft, setDraft] = useState<MemoryDraft | null>(null)
  const [evidenceId, setEvidenceId] = useState("")
  useEffect(() => {
    const reveal = (event: Event) => setEvidenceId((event as CustomEvent<string>).detail)
    window.addEventListener(SHOW_REPLY_EVIDENCE, reveal)
    return () => window.removeEventListener(SHOW_REPLY_EVIDENCE, reveal)
  }, [])
  const revisions = new Map<string, string>()
  for (const message of messages) {
    const meta = message.metadata as
      { supersedesExecutionId?: string; workflowStep?: number } | undefined
    if (
      message.role === "assistant" &&
      meta?.workflowStep === 2 &&
      meta.supersedesExecutionId
    )
      revisions.set(meta.supersedesExecutionId, message.id)
  }
  const last = messages.at(-1)
  const busy = status === "streaming" || status === "submitted"
  const currentReply = workingMessageId
    ? messages.find(m => m.id === workingMessageId)
    : last
  const activeReplyId =
    status === "streaming" && currentReply?.role === "assistant"
      ? currentReply.id
      : undefined
  const waiting = busy && !activeReplyId
  const pendingSpeakerId =
    status === "streaming" && !workingMessageId && last?.role === "user"
      ? getMessageBotId(last) ?? pendingBotId
      : pendingBotId
  const projected = projectReplyVersions(messages)
  const pendingRoot = pendingRevisionId && projected.byMessage.get(pendingRevisionId)?.replies[0]
  const pendingBot = bots.find(bot => bot.id === ((pendingRoot && getMessageBotId(pendingRoot)) || pendingSpeakerId))
  const groups = chatTurnGroups(projected.messages)
  const evidenceSlot = projected.byMessage.get(evidenceId)
  const evidenceVersion = evidenceSlot?.replies.findIndex(reply => reply.id === evidenceId) ?? -1
  const citedMessage = evidenceId && !groups.some(group => group.current.some(message => message.id === evidenceId))
    ? messages.find(message => message.id === evidenceId)
    : undefined
  const pendingAfter = waiting && (pendingRevisionId || (last?.role === "user" && (retryTarget(last)?.replyId ?? last.id)))
  const waitingHeader = waiting && (
    <Message><MessageContent>
      <AssistantHeader bot={pendingBot} name={pendingBot?.name ?? "Assistant"} waitingForText />
    </MessageContent></Message>
  )
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Chat messages">
          <MessageScrollerContent className="mx-auto w-full max-w-2xl gap-6 px-4 py-6 sm:px-6">
            {messages.length === 0 && !busy && (
              <MessageScrollerItem messageId="empty">
                <Empty className="min-h-64 border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageCircleIcon />
                    </EmptyMedia>
                    <EmptyTitle>Start a conversation</EmptyTitle>
                    <EmptyDescription>
                      Ask a question or share what you’re working on.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            )}
            {groups.flatMap(({ current }) =>
              current
                .filter((message) => message.role !== "system")
                .map((message) => {
                  const meta = message.metadata as
                    | {
                        executionId?: string
                        workflow?: unknown
                        checkpointNote?: boolean
                      }
                    | undefined
                  const revisionId =
                    meta?.executionId && revisions.get(meta.executionId)
                  const slot = projected.byMessage.get(message.id)
                  const ordinary =
                    !current[0]?.id.startsWith("workflow_") &&
                    !(
                      current[0]?.metadata as { workflow?: unknown } | undefined
                    )?.workflow
                  return (
                    <MessageScrollerItem
                      key={slot?.replies[0].id ?? message.id}
                      id={"chat-message-" + message.id}
                      messageId={message.id}
                      data-evidence-message={message.id}
                    >
                      {revisionId && (
                        <a
                          className="mb-2 inline-block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                          href={"#chat-message-" + revisionId}
                        >
                          此评判已修订，查看修正结论与依据
                        </a>
                      )}
                      <ChatTurn
                        versions={ordinary ? slot : undefined}
                        chooseVersion={chooseVersion}
                        onRevise={
                          ordinary && !meta?.checkpointNote
                            ? onRevise
                            : undefined
                        }
                        revisionBusy={revisionBusy}
                        onRemember={
                          directChatId && !isGroup ? setDraft : undefined
                        }
                        message={message}
                        bots={bots}
                        isGroup={isGroup}
                        streaming={message.id === activeReplyId}
                        busy={busy}
                        onApproval={
                          message.id === last?.id ? onApproval : undefined
                        }
                      />
                      {(pendingAfter === message.id ||
                        (slot && pendingAfter === slot.replies[0].id)) && (
                        <div className="mt-6">{waitingHeader}</div>
                      )}
                    </MessageScrollerItem>
                  )
                })
            )}
            {waiting && !pendingAfter && (
              <MessageScrollerItem messageId="responding">
                {waitingHeader}
              </MessageScrollerItem>
            )}
            {citedMessage && (
              <MessageScrollerItem
                messageId={"evidence-" + evidenceId}
                data-evidence-message={evidenceId}
              >
                <details
                  open
                  key={evidenceId}
                  className="rounded-md border px-3 py-2"
                >
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {evidenceVersion >= 0
                      ? `Cited reply · Version ${evidenceVersion + 1}`
                      : "Cited message"}
                  </summary>
                  <ChatTurn
                    message={citedMessage}
                    bots={bots}
                    isGroup={isGroup}
                    streaming={false}
                    busy={false}
                  />
                </details>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label="Scroll to latest message" />
      </MessageScroller>
      {draft && directChatId && !isGroup && bots[0] && (
        <SaveMemoryDialog
          chatId={directChatId}
          botName={bots[0].name}
          draft={draft}
          close={() => setDraft(null)}
        />
      )}
    </MessageScrollerProvider>
  )
}
