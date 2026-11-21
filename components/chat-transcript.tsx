"use client"
import { toolCallAnchor } from "@/lib/project-decisions"

import { memo, useState } from "react"
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
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { mentionPattern } from "@/lib/chat-mentions"
import { ChatMention, ChatMarkdown } from "@/components/chat-markdown"
import { ChatMessageActions } from "@/components/chat-message-actions"
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

function Responding() {
  return (
    <Trace>
      <TraceLine status="running">
        <TraceIcon>
          <MessageCircleIcon />
        </TraceIcon>
        <TraceTitle>Responding</TraceTitle>
      </TraceLine>
    </Trace>
  )
}

function AssistantParts({
  message,
  speaker,
  parts,
  bots,
  streaming,
  busy,
  onApproval,
}: {
  message: UIMessage
  speaker?: { name: string; id: string | null }
  parts: IndexedChatPart[]
  bots: ChatSpeaker[]
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
                {cleanBotText(block.part.text, bots, streaming)}
              </ChatMarkdown>
            </div>
          )
        if (block.part.type === "file")
          return <ChatFile key={block.key} part={block.part} />
        return null
      })}
      {streaming && blocks.length === 0 && <Responding />}
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
  onApproval,
}: {
  message: UIMessage
  bots: ChatSpeaker[]
  isGroup: boolean
  streaming: boolean
  busy: boolean
  onRemember?: (draft: MemoryDraft) => void
  onApproval?: RespondToApproval
}) {
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
          <Bubble
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
          </Bubble>
          <ChatMessageActions
            text={text}
            remember={
              onRemember && bots[0]
                ? {
                    label: "Remember with " + bots[0].name,
                    open: () => onRemember({ messageId: message.id, text }),
                  }
                : undefined
            }
          />
        </MessageContent>
      </Message>
    )
  }

  const handoff = message.parts.map(getHandoff).find(Boolean)
  const segments = getAssistantSegments(
    message,
    isGroup ? null : (bots[0]?.id ?? null)
  )
  return (
    <MessageGroup className="gap-5">
      {segments.map((segment) => {
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
        return (
          <Message key={segment.key}>
            <MessageContent className="gap-2">
              <MessageHeader>
                <SpeakerAvatar bot={bot} />
                <BotName
                  name={name}
                  job={bot?.job}
                />
              </MessageHeader>
              <AssistantParts
                message={message}
                speaker={isGroup ? { id: segment.botId, name } : undefined}
                parts={segment.parts}
                bots={bots}
                streaming={streaming}
                busy={busy}
                onApproval={onApproval}
              />
              {!!(message.metadata as { workflowStep?: number } | undefined)?.workflowStep && <WorkflowEvidence message={message} />}
              {!streaming && (
                <ChatMessageActions
                  text={segment.parts
                    .map(({ part }) =>
                      part.type === "text"
                        ? cleanBotText(part.text, bots, false)
                        : ""
                    )
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
  onApproval,
}: {
  directChatId?: string
  messages: UIMessage[]
  bots: ChatSpeaker[]
  isGroup: boolean
  status: ChatStatus
  pendingBotId?: string
  workingMessageId?: string
  onApproval?: RespondToApproval
}) {
  const [draft, setDraft] = useState<MemoryDraft | null>(null)
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
  const pendingBot =
    (workingMessageId ? bots.find((bot) => bot.id === pendingBotId) : undefined) ??
    bots.find((bot) => bot.id === (last && getMessageBotId(last))) ??
    bots.find((bot) => bot.id === pendingBotId)
  const waiting =
    busy && (!last || last.role !== "assistant" || last.parts.length === 0 || (!!workingMessageId && !messages.some(m => m.id === workingMessageId)))
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
            {messages
              .filter((message) => message.role !== "system")
              .map((message) => {
                const meta = message.metadata as
                  { executionId?: string } | undefined
                const revisionId =
                  meta?.executionId && revisions.get(meta.executionId)
                return (
                  <MessageScrollerItem
                    key={message.id}
                    id={"chat-message-" + message.id}
                    messageId={message.id}
                    data-evidence-message={message.id}
                    scrollAnchor={message.role === "user"}
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
                      onRemember={
                        directChatId && !isGroup ? setDraft : undefined
                      }
                      message={message}
                      bots={bots}
                      isGroup={isGroup}
                      streaming={
                        status === "streaming" && message.id === (workingMessageId ?? last?.id)
                      }
                      busy={busy}
                      onApproval={
                        message.id === last?.id ? onApproval : undefined
                      }
                    />
                  </MessageScrollerItem>
                )
              })}
            {waiting && (
              <MessageScrollerItem messageId="responding">
                <Message>
                  <MessageContent>
                    <MessageHeader>
                      <SpeakerAvatar bot={pendingBot} />
                      <BotName
                        name={pendingBot?.name ?? "Assistant"}
                        job={pendingBot?.job}
                      />
                    </MessageHeader>
                    <Responding />
                  </MessageContent>
                </Message>
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
