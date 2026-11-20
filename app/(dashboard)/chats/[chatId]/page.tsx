import { notFound } from "next/navigation"

import { ChatPageClient } from "@/components/chat-page-client"
import { ChatInterface } from "@/components/chat-interface"
import { NativeDirectChat } from "@/components/native-direct-chat"
import { nativeChatMember } from "@/lib/native-direct-chat"
import { readNativeTranscript } from "@/queries/native-chat"
import { assertInstallationRequest } from "@/lib/installation-request.server"
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

  if (chat.nativeDirect) {
    await assertInstallationRequest()
    if (!nativeChatMember(chat)) notFound()
  }
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <ChatPageClient chat={chat} bots={bots}>
        {chat.nativeDirect ? (
          <NativeDirectChat
            key={chat.id}
            chat={chat}
            messages={await readNativeTranscript(chat.id)}
          />
        ) : (
          <ChatInterface
            key={chat.id}
            chatId={chat.id}
            bots={chat.bots}
            isGroup={chat.kind === "group"}
          />
        )}
      </ChatPageClient>
    </main>
  )
}
