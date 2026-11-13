"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"

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
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"

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

export function ChatInterface({ chatId }: { chatId: string }) {
  const { messages, sendMessage, status, stop } = useChat({
    id: chatId,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  })

  async function handleSubmit({ text }: PromptInputMessage) {
    if (!text.trim() || status !== "ready") {
      return
    }

    await sendMessage({ text })
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
            <div />
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
