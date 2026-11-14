import { notFound } from "next/navigation"

import { ChatInterface } from "@/components/chat-interface"
import { ChatHeader } from "@/components/chat-header"
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
    <main className="dark flex min-h-svh flex-1 flex-col bg-background text-foreground">
      <ChatHeader chat={chat} bots={bots} />
      <ChatInterface
        chatId={chatId}
        bots={chat.bots}
        isGroup={chat.kind === "group"}
      />
    </main>
  )
}
