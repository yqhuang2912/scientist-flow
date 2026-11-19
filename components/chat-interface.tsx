"use client"

import { useState } from "react"
import { useChat } from "@ai-sdk/react"
import {
  useLoadTranscript,
  useSubAgentMessages,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai"
import { CircleAlertIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import { ChatTranscript } from "@/components/chat-transcript"
import { fileToDataUrl, type ChatComposerMessage } from "@/lib/chat-composer"
import { ChatComposer } from "@/components/chat-composer"
import {
  loadChatTranscript,
  mintChatAccessToken,
  startChatSession,
  prepareChatTurn,
} from "@/actions/chat"
import { saveChatAttachmentAction } from "@/actions/workspace"
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
  const recipients = useSubAgentMessages()
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
    onData: recipients.onData,
    resume: initialMessages.length > 0,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })

  const persistedIds = new Set(messages.map((m) => m.id))
  const displayMessages = messages.flatMap((m) => {
    const id = (m.metadata as { executionId?: string } | undefined)?.executionId
    const reply = id ? recipients.get(id) : undefined
    return reply && !persistedIds.has(reply.id) ? [m, reply] : [m]
  })
  function stop() {
    stopChat()
    void transport.stopGeneration(chatId)
  }

  async function handleSubmit({ text, files }: ChatComposerMessage) {
    if (
      (!text.trim() && files.length === 0) ||
      status === "submitted" ||
      status === "streaming"
    ) {
      return
    }

    const problem = await prepareChatTurn(chatId, selectedBotId)
    if (problem) return { error: problem }
    router.refresh()

    const metadata = selectedBotId ? { botId: selectedBotId } : undefined
    // Attachments are saved into the task's uploads folder first, so the file
    // outlives this tab and the model can reach it from its workspace. The
    // message then carries the same bytes as file parts for the model to read
    // directly, and the stored path so the answer can refer to it.
    const saved = await Promise.all(
      files.map(async (file) => {
        const url = await fileToDataUrl(file)
        const result = await saveChatAttachmentAction(chatId, file)
        return {
          type: "file" as const,
          mediaType: file.type || "application/octet-stream",
          filename: file.name,
          url,
          ...(result.success ? { workspacePath: result.entry.relPath } : {}),
        }
      })
    )
    const parts = [
      ...(text.trim() ? [{ type: "text" as const, text }] : []),
      ...saved,
    ]

    await sendMessage({ parts, metadata }, metadata ? { metadata } : undefined)
  }

  return (
    <div
      data-project-chat={isGroup ? chatId : undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ChatTranscript
        key={chatId}
        directChatId={isGroup ? undefined : chatId}
        messages={displayMessages}
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
