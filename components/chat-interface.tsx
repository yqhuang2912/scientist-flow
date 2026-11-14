"use client"

import { useState } from "react"
import { useChat } from "@ai-sdk/react"
import {
  useLoadTranscript,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import type { UIMessage } from "ai"
import { ArrowRightIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import {
  loadChatTranscript,
  mintChatAccessToken,
  startChatSession,
  touchChatActivity,
} from "@/actions/chat"
import type { chatAgent } from "@/trigger/chat"
import type { ChatWithBot } from "@/queries/chats"
import { Badge } from "@/components/ui/badge"
import { ChatAvatar } from "@/components/chat-avatar"

type ChatBot = ChatWithBot["bots"][number]

function AssistantMessageRow({
  bot,
  children,
}: {
  bot: ChatBot | null | undefined
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3">
      {bot ? (
        <ChatAvatar
          seed={bot.avatar}
          animated
          alt={`${bot.name} avatar`}
          className="size-7 shrink-0 rounded-lg"
        />
      ) : (
        <div aria-hidden className="size-7" />
      )}
      {children}
    </div>
  )
}

function MessageParts({
  message,
  isStreaming,
  bots,
  isGroup,
}: {
  message: UIMessage
  isStreaming: boolean
  bots: ChatBot[]
  isGroup: boolean
}) {
  const botId =
    isGroup && message.role === "assistant" ? getMessageBotId(message) : null
  const bot = botId ? bots.find((candidate) => candidate.id === botId) : null
  const userBotId =
    isGroup && message.role === "user" ? getMessageBotId(message) : null
  const userBot = userBotId
    ? bots.find((candidate) => candidate.id === userBotId)
    : null
  const handoffPart = isGroup ? getHandoffPart(message) : null
  const handoffOutput = handoffPart ? getHandoffOutput(handoffPart) : null

  if (message.role === "assistant" && isGroup && handoffPart) {
    const sourceBot = handoffOutput?.handedOffFrom?.id
      ? bots.find(
          (candidate) => candidate.id === handoffOutput.handedOffFrom?.id
        )
      : bot
    const targetBot = handoffOutput?.handedOffTo.id
      ? bots.find((candidate) => candidate.id === handoffOutput.handedOffTo.id)
      : bot
    const handoffLabel = getHandoffLabel(handoffPart)
    const textParts = message.parts.filter((part) => part.type === "text")

    return (
      <Message from={message.role}>
        {handoffLabel && (
          <AssistantMessageRow bot={sourceBot}>
            <MessageContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ArrowRightIcon className="size-4" />
                {handoffLabel}
              </div>
            </MessageContent>
          </AssistantMessageRow>
        )}
        {textParts.length > 0 && (
          <AssistantMessageRow bot={targetBot}>
            <MessageContent>
              {textParts.map((part, index) => (
                <MessageResponse
                  key={`${message.id}-handoff-text-${index}`}
                  isAnimating={isStreaming}
                >
                  {part.text}
                </MessageResponse>
              ))}
            </MessageContent>
          </AssistantMessageRow>
        )}
      </Message>
    )
  }

  return (
    <Message from={message.role}>
      {message.role === "assistant" && isGroup ? (
        <AssistantMessageRow bot={bot}>
          <MessageContent>
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return (
                  <MessageResponse
                    key={`${message.id}-${index}`}
                    isAnimating={isStreaming}
                  >
                    {part.text}
                  </MessageResponse>
                )
              }

              const handoffLabel = getHandoffLabel(part)
              if (!handoffLabel) {
                return null
              }

              return (
                <div
                  key={`${message.id}-${index}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <ArrowRightIcon className="size-4" />
                  {handoffLabel}
                </div>
              )
            })}
          </MessageContent>
        </AssistantMessageRow>
      ) : (
        <MessageContent>
          {userBot && (
            <Badge variant="outline" className="gap-1.5 px-1.5 pr-2 text-xs">
              <ChatAvatar
                seed={userBot.avatar}
                animated
                alt={`${userBot.name} avatar`}
                className="size-4 rounded-sm"
              />
              {userBot.name}
            </Badge>
          )}
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return (
                <MessageResponse
                  key={`${message.id}-${index}`}
                  isAnimating={isStreaming}
                >
                  {part.text}
                </MessageResponse>
              )
            }

            const handoffLabel = getHandoffLabel(part)
            if (!handoffLabel) {
              return null
            }

            return (
              <div
                key={`${message.id}-${index}`}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <ArrowRightIcon className="size-4" />
                {handoffLabel}
              </div>
            )
          })}
        </MessageContent>
      )}
    </Message>
  )
}

function getMessageBotId(message: UIMessage) {
  if (!message.metadata || typeof message.metadata !== "object") {
    return null
  }

  const botId = (message.metadata as { botId?: unknown }).botId
  return typeof botId === "string" ? botId : null
}

type HandoffOutput = {
  success: true
  handedOffFrom?: {
    id: string
  } | null
  handedOffTo: {
    id?: string
    name: string
  }
}

type HandoffPart = {
  type: "tool-handoff"
  state: string
  output?: unknown
}

function isHandoffOutput(value: unknown): value is HandoffOutput {
  if (!value || typeof value !== "object") {
    return false
  }

  const output = value as Partial<HandoffOutput>
  return (
    output.success === true &&
    !!output.handedOffTo &&
    typeof output.handedOffTo.name === "string"
  )
}

function getHandoffPart(message: UIMessage) {
  const part = message.parts.find((part) => part.type === "tool-handoff")
  return part ? (part as unknown as HandoffPart) : null
}

function getHandoffOutput(part: HandoffPart) {
  if (part.state !== "output-available" || !isHandoffOutput(part.output)) {
    return null
  }

  return part.output
}

function getHandoffLabel(part: unknown) {
  if (!part || typeof part !== "object" || !("type" in part)) {
    return null
  }

  if (part.type !== "tool-handoff") {
    return null
  }

  const handoffPart = part as HandoffPart

  if (handoffPart.state === "input-available") {
    return "Handing off..."
  }

  const output = getHandoffOutput(handoffPart)
  if (!output) {
    return null
  }

  return `Handed off to ${output.handedOffTo.name}`
}

export function ChatInterface({
  chatId,
  bots,
  isGroup,
}: {
  chatId: string
  bots: ChatBot[]
  isGroup: boolean
}) {
  const transport = useTriggerChatTransport<typeof chatAgent>({
    task: "chat-agent",
    accessToken: ({ chatId: sessionChatId }) =>
      mintChatAccessToken(sessionChatId),
    startSession: ({ chatId: sessionChatId, clientData }) =>
      startChatSession({ chatId: sessionChatId, clientData }),
    clientData: { botId: bots[0]?.id },
  })

  const {
    messages: initialMessages,
    isLoading,
    error: transcriptError,
  } = useLoadTranscript(chatId, loadChatTranscript, { transport })

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading conversation...
      </div>
    )
  }

  if (transcriptError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        Unable to load conversation.
      </div>
    )
  }

  return (
    <ChatView
      chatId={chatId}
      bots={bots}
      isGroup={isGroup}
      initialMessages={initialMessages}
      transport={transport}
    />
  )
}

function ChatView({
  chatId,
  bots,
  isGroup,
  initialMessages,
  transport,
}: {
  chatId: string
  bots: ChatBot[]
  isGroup: boolean
  initialMessages: UIMessage[]
  transport: ReturnType<typeof useTriggerChatTransport>
}) {
  const [selectedBotId, setSelectedBotId] = useState(bots[0]?.id ?? "")
  const router = useRouter()
  const {
    messages,
    sendMessage,
    status,
    stop: stopChat,
  } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    resume: initialMessages.length > 0,
  })

  function stop() {
    stopChat()
    void transport.stopGeneration(chatId)
  }

  async function handleSubmit({ text }: PromptInputMessage) {
    if (!text.trim() || status !== "ready") {
      return
    }

    await touchChatActivity(chatId)
    router.refresh()

    const metadata = selectedBotId ? { botId: selectedBotId } : undefined

    await sendMessage({ text, metadata }, metadata ? { metadata } : undefined)
  }

  const lastMessageId = messages.at(-1)?.id

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Start a conversation"
              description="Ask your bot anything to get started."
            />
          ) : (
            messages.map((message) => (
              <MessageParts
                key={message.id}
                message={message}
                bots={bots}
                isGroup={isGroup}
                isStreaming={
                  status === "streaming" && message.id === lastMessageId
                }
              />
            ))
          )}
        </ConversationContent>
      </Conversation>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea placeholder="Message your bot..." />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              {bots.length > 0 && (
                <PromptInputSelect
                  value={selectedBotId}
                  onValueChange={(value) => {
                    if (typeof value === "string") {
                      setSelectedBotId(value)
                    }
                  }}
                >
                  <PromptInputSelectTrigger
                    size="sm"
                    aria-label="Choose a bot"
                    disabled={bots.length < 2}
                    className="max-w-48"
                  >
                    <PromptInputSelectValue>
                      {bots.find((bot) => bot.id === selectedBotId)?.name ??
                        "Choose a bot"}
                    </PromptInputSelectValue>
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    {bots.map((bot) => (
                      <PromptInputSelectItem key={bot.id} value={bot.id}>
                        <ChatAvatar
                          seed={bot.avatar}
                          animated
                          alt={`${bot.name} avatar`}
                          className="size-5 rounded-md"
                        />
                        {bot.name}
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
              )}
            </PromptInputTools>
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
