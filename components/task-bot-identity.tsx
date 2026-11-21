import { BotName } from "./bot-name"
import { ChatAvatar } from "./chat-avatar"
import { compactChatAvatarStyles } from "./ui/compact-styles"

export function TaskBotIdentity({
  bot,
}: {
  bot: { name: string; avatar: string; job?: string | null }
}) {
  return (
    <>
      <ChatAvatar
        seed={bot.avatar}
        animated
        alt=""
        className={compactChatAvatarStyles}
      />
      <BotName name={bot.name} job={bot.job} className="flex-1" />
    </>
  )
}
