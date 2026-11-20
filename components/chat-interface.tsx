"use client"

import {
  useLoadTranscript,
  useSubAgentMessages,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import {
  loadChatTranscript,
  mintChatAccessToken,
  startChatSession,
} from "@/actions/chat"
import { ChatView } from "./chat-view"
import type { chatAgent } from "@/trigger/chat"
import type { ChatWithBot } from "@/queries/chats"

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
  const recipients = useSubAgentMessages()
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
      key={chatId}
      chatId={chatId}
      bots={bots}
      isGroup={isGroup}
      initialMessages={initialMessages}
      transport={transport}
      legacy={{
        ...recipients,
        stop: () => void transport.stopGeneration(chatId),
      }}
    />
  )
}
