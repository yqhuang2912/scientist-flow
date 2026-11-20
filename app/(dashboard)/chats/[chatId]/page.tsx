import { notFound } from "next/navigation"

import { ChatPageClient } from "@/components/chat-page-client"
import { ChatInterface } from "@/components/chat-interface"
import { chatSnapshot } from "@/lib/chat-jobs.server"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import { getBots } from "@/queries/bots"
import { getChat } from "@/queries/chats"

export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  await assertInstallationRequest()
  const { chatId } = await params
  const [chat, bots] = await Promise.all([getChat(chatId), getBots()])

  if (!chat) {
    notFound()
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <ChatPageClient chat={chat} bots={bots}>
        <ChatInterface
          key={chat.id}
          chat={chat}
          initial={await chatSnapshot(chatId)}
        />
      </ChatPageClient>
    </main>
  )
}
