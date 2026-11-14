"use client"

import { useState } from "react"
import { useChat } from "@ai-sdk/react"
import {
  useLoadTranscript,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import type { UIMessage } from "ai"

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
} from "@/actions/chat"
import type { chatAgent } from "@/trigger/chat"
import type { ChatWithBot } from "@/queries/chats"
import { ChatAvatar } from "@/components/chat-avatar"

type ChatBot = ChatWithBot["bots"][number]

function MessageParts({
  message,
  isStreaming,
}: {
  message: UIMessage
  isStreaming: boolean
}) {
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) =>
          part.type === "text" ? (
            <MessageResponse
              key={`${message.id}-${index}`}
              isAnimating={isStreaming}
            >
              {part.text}
            </MessageResponse>
          ) : null
        )}
      </MessageContent>
    </Message>
  )
}

export function ChatInterface({
  chatId,
  bots,
}: {
  chatId: string
  bots: ChatBot[]
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
      initialMessages={initialMessages}
      transport={transport}
    />
  )
}

function ChatView({
  chatId,
  bots,
  initialMessages,
  transport,
}: {
  chatId: string
  bots: ChatBot[]
  initialMessages: UIMessage[]
  transport: ReturnType<typeof useTriggerChatTransport>
}) {
  const [selectedBotId, setSelectedBotId] = useState(bots[0]?.id ?? "")
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

    await sendMessage(
      { text },
      { metadata: selectedBotId ? { botId: selectedBotId } : undefined }
    )
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
