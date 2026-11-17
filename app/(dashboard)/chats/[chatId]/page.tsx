import { notFound } from "next/navigation"

import { ChatPageClient } from "@/components/chat-page-client"
import { getBots } from "@/queries/bots"
import { getChat } from "@/queries/chats"

export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  const { chatId } = await params
  const [chat, bots] = await Promise.all([getChat(chatId), getBots()])

  if (!chat) {
    notFound()
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <ChatPageClient chat={chat} bots={bots} />
    </main>
  )
}
