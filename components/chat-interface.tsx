"use client"

import { useState } from "react"
import { useChat } from "@ai-sdk/react"
import {
  useLoadTranscript,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai"
import { CircleAlertIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import { ChatTranscript } from "@/components/chat-transcript"
import type { ChatComposerMessage } from "@/lib/chat-composer"
import { ChatComposer } from "@/components/chat-composer"
import {
  loadChatTranscript,
  mintChatAccessToken,
  startChatSession,
  touchChatActivity,
} from "@/actions/chat"
import type { chatAgent } from "@/trigger/chat"
import type { ChatWithBot } from "@/queries/chats"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type ChatBot = ChatWithBot["bots"][number]

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
    error,
    clearError,
    addToolApprovalResponse,
    stop: stopChat,
  } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    resume: initialMessages.length > 0,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })

  function stop() {
    stopChat()
    void transport.stopGeneration(chatId)
  }

  async function handleSubmit({ text }: ChatComposerMessage) {
    if (!text.trim() || status === "submitted" || status === "streaming") {
      return
    }

    await touchChatActivity(chatId)
    router.refresh()

    const metadata = selectedBotId ? { botId: selectedBotId } : undefined

    await sendMessage({ text, metadata }, metadata ? { metadata } : undefined)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatTranscript
        messages={messages}
        bots={bots}
        isGroup={isGroup}
        status={status}
        pendingBotId={selectedBotId}
        onApproval={addToolApprovalResponse}
      />
      {/* The composer tracks the transcript's width so the input lines up with
          the messages above it. */}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pb-3 sm:px-6">
        {error && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Response interrupted</AlertTitle>
            <AlertDescription>
              <p>
                {error.message ||
                  "Could not complete the response. Send a message to try again."}
              </p>
              <Button size="sm" variant="outline" onClick={clearError}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <ChatComposer
          bots={bots}
          selectedBotId={selectedBotId}
          onBotChange={setSelectedBotId}
          onSubmit={handleSubmit}
          status={status}
          onStop={stop}
        />
      </div>
    </div>
  )
}
