"use client"

import { useMemo } from "react"
import { DefaultChatTransport, type UIMessage } from "ai"
import type { ChatWithBot } from "@/queries/chats"
import { ChatView } from "./chat-view"

export function NativeDirectChat({
  chat,
  messages,
}: {
  chat: ChatWithBot
  messages: UIMessage[]
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chats/" + encodeURIComponent(chat.id) + "/messages",
        prepareSendMessagesRequest: ({ messages }) => {
          const user = messages.at(-1)
          const part = user?.parts[0]
          if (
            user?.role !== "user" ||
            user.parts.length !== 1 ||
            part?.type !== "text"
          )
            throw new Error("This chat supports text messages only.")
          return {
            body: { id: user.id, botId: chat.bots[0].id, text: part.text },
          }
        },
      }),
    [chat.id, chat.bots]
  )
  return (
    <ChatView
      chatId={chat.id}
      bots={chat.bots}
      isGroup={false}
      initialMessages={messages}
      transport={transport}
    />
  )
}
