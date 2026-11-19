"use client"

import { memo, useState } from "react"
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
import { ChatMarkdown } from "@/components/chat-markdown"
import { ChatMessageActions } from "@/components/chat-message-actions"
import { BotName } from "@/components/bot-name"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  ChatActivity,
  ChatApproval,
  ChatFile,
  type RespondToApproval,
} from "@/components/chat-activity"
import { cleanBotText } from "@/lib/chat-bot-text"
import { cn } from "@/lib/utils"
import {
  getAssistantSegments,
  getHandoff,
  getMessageBotId,
  groupChatParts,
  type ChatSpeaker,
  type IndexedChatPart,
} from "@/lib/chat-presentation"

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
  parts,
  bots,
  streaming,
  busy,
  onApproval,
}: {
  parts: IndexedChatPart[]
  bots: ChatSpeaker[]
  streaming: boolean
  busy: boolean
  onApproval?: RespondToApproval
}) {
  const blocks = groupChatParts(parts)
  return (
    // Match the visible avatar/copy glyphs, which sit inside their hit boxes.
    <div className="flex min-w-0 flex-col gap-3 pl-1">
      {blocks.map((block) => {
        if (block.kind === "activity")
          return (
            <Trace key={block.key}>
              {block.parts.map(({ part, index }) => (
                <ChatActivity
                  key={isToolUIPart(part) ? part.toolCallId : index}
                  part={part}
                  active={streaming}
                />
              ))}
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
    const addressedBot = isGroup
      ? bots.find((bot) => bot.id === getMessageBotId(message))
      : undefined
    const firstText = message.parts.findIndex((part) => part.type === "text")
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
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
                {message.parts.map((part, index) => {
                  if (part.type === "file")
                    return <ChatFile key={index} part={part} />
                  if (part.type !== "text") return null
                  return (
                    <div
                      key={index}
                      data-evidence-part={index}
                      tabIndex={-1}
                      className="min-w-0 rounded-sm focus-visible:outline-ring"
                    >
                      {addressedBot && index === firstText && (
                        <span
                          className="mr-2.5 inline-flex max-w-32 items-baseline gap-0.5 text-muted-foreground"
                          title={`@${addressedBot.name}`}
                        >
                          <span className="relative -top-px">@</span>
                          <span className="min-w-0 truncate">
                            {addressedBot.name}
                          </span>
                        </span>
                      )}
                      <ChatMarkdown
                        variant="user"
                        className={cn(
                          "min-w-0",
                          addressedBot &&
                            index === firstText &&
                            "inline [&>p:first-child]:inline [&>p:first-child+*]:mt-4"
                        )}
                      >
                        {part.text}
                      </ChatMarkdown>
                    </div>
                  )
                })}
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
        const bot = bots.find((candidate) => candidate.id === segment.botId)
        const pastName =
          handoff && segment.botId === handoff.sourceId
            ? handoff.sourceName
            : handoff && segment.botId === handoff.targetId
              ? handoff.targetName
              : null
        return (
          <Message key={segment.key}>
            <MessageContent className="gap-2">
              <MessageHeader>
                <SpeakerAvatar bot={bot} />
                <BotName
                  name={bot?.name ?? pastName ?? "Assistant"}
                  job={bot?.job}
                />
              </MessageHeader>
              <AssistantParts
                parts={segment.parts}
                bots={bots}
                streaming={streaming}
                busy={busy}
                onApproval={onApproval}
              />
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
  onApproval,
}: {
  directChatId?: string
  messages: UIMessage[]
  bots: ChatSpeaker[]
  isGroup: boolean
  status: ChatStatus
  pendingBotId?: string
  onApproval?: RespondToApproval
}) {
  const [draft, setDraft] = useState<MemoryDraft | null>(null)
  const last = messages.at(-1)
  const busy = status === "streaming" || status === "submitted"
  const pendingBot =
    bots.find((bot) => bot.id === (last && getMessageBotId(last))) ??
    bots.find((bot) => bot.id === pendingBotId)
  const waiting =
    busy && (!last || last.role !== "assistant" || last.parts.length === 0)
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
              .map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  data-evidence-message={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatTurn
                    onRemember={directChatId && !isGroup ? setDraft : undefined}
                    message={message}
                    bots={bots}
                    isGroup={isGroup}
                    streaming={
                      status === "streaming" && message.id === last?.id
                    }
                    busy={busy}
                    onApproval={
                      message.id === last?.id ? onApproval : undefined
                    }
                  />
                </MessageScrollerItem>
              ))}
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
