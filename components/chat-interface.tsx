"use client"

import { useRef, useState } from "react"
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
import { attachmentMediaType, chatAttachmentParts, legacyAttachmentReferences, type ChatComposerMessage } from "@/lib/chat-composer"
import { prepareChatAttachments } from "@/actions/chat-attachments"
import { ChatComposer } from "@/components/chat-composer"
import {
  loadChatTranscript,
  mintChatAccessToken,
  startChatSession,
  prepareChatTurn,
} from "@/actions/chat"
import { CHAT_UPLOAD_EVENT, uploadFiles } from "@/lib/workspace-upload-client"
import type { UploadedEntry } from "@/lib/workspace-validation"
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
      key={chatId}
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
  const uploaded = useRef(new WeakMap<File, UploadedEntry>())
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

    const entries: UploadedEntry[] = []
    try {
      await uploadFiles(
        { chatId, attachment: true },
        files,
        (entry) => {
          entries.push(entry)
          window.dispatchEvent(
            new CustomEvent(CHAT_UPLOAD_EVENT, { detail: chatId })
          )
        },
        uploaded.current
      )
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not upload the attachment.",
      }
    }
    const current = entries.map((entry, i) => ({
      name: files[i].name,
      relativePath: entry.relPath,
      size: entry.size,
      mediaType: attachmentMediaType(files[i])!,
    }))
    const references = [
      ...current,
      ...legacyAttachmentReferences(messages, current),
    ]
    let prepared
    try {
      prepared = references.length
        ? await prepareChatAttachments(chatId, references)
        : []
    } catch {
      return { error: "Could not prepare the attachments. Check the task workspace and try again." }
    }
    const { parts, workspaceFiles } = chatAttachmentParts(prepared, text)
    const metadata = {
      ...(selectedBotId && { botId: selectedBotId }),
      ...(prepared.length > 0 && { workspaceFiles }),
    }
    if (new TextEncoder().encode(JSON.stringify({ parts, metadata })).length > 480 * 1024) {
      return { error: "This message is too large. Shorten the text or send fewer attachments together." }
    }
    await sendMessage({ parts, metadata }, { metadata })
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
