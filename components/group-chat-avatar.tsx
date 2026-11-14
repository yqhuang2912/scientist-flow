"use client"

import { ChatAvatar } from "@/components/chat-avatar"
import { cn } from "@/lib/utils"

type GroupChatBot = {
  id: string
  name: string
  avatar: string
}

interface GroupChatAvatarProps {
  bots: GroupChatBot[]
  fallbackSeed?: string
  animated?: boolean
  className?: string
  alt?: string
}

export function GroupChatAvatar({
  bots,
  fallbackSeed = "group-chat",
  animated = false,
  className,
  alt = "Group chat avatar",
}: GroupChatAvatarProps) {
  const visibleBots = bots.slice(0, 3)
  const remainingCount = Math.max(0, bots.length - visibleBots.length)

  if (visibleBots.length === 0) {
    return (
      <ChatAvatar
        seed={fallbackSeed}
        animated={animated}
        alt={alt}
        className={cn("size-8 rounded-lg", className)}
      />
    )
  }

  const avatarClassName = "size-full rounded-none"

  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        "relative isolate aspect-square size-8 overflow-hidden rounded-lg",
        className
      )}
    >
      {visibleBots.length === 1 && (
        <ChatAvatar
          seed={visibleBots[0].avatar}
          animated={animated}
          alt={visibleBots[0].name}
          className={avatarClassName}
        />
      )}

      {visibleBots.length === 2 &&
        visibleBots.map((bot, index) => (
          <ChatAvatar
            key={bot.id}
            seed={bot.avatar}
            animated={animated}
            alt={bot.name}
            className={cn(
              "absolute top-1/2 size-[72%] -translate-y-1/2 rounded-md",
              index === 0 ? "left-0" : "right-0"
            )}
          />
        ))}

      {visibleBots.length === 3 &&
        remainingCount === 0 &&
        visibleBots.map((bot, index) => (
          <ChatAvatar
            key={bot.id}
            seed={bot.avatar}
            animated={animated}
            alt={bot.name}
            className={cn(
              "absolute size-[64%] rounded-md",
              index === 0 && "top-0 left-1/2 -translate-x-1/2",
              index === 1 && "bottom-0 left-0",
              index === 2 && "right-0 bottom-0"
            )}
          />
        ))}

      {visibleBots.length === 3 &&
        remainingCount > 0 &&
        visibleBots.map((bot, index) => (
          <ChatAvatar
            key={bot.id}
            seed={bot.avatar}
            animated={animated}
            alt={bot.name}
            className={cn(
              "absolute size-[60%] rounded-md",
              index === 0 && "top-0 left-0",
              index === 1 && "top-0 right-0",
              index === 2 && "bottom-0 left-0"
            )}
          />
        ))}

      {remainingCount > 0 && (
        <div className="absolute right-0 bottom-0 flex size-1/2 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
          +{remainingCount}
        </div>
      )}
    </div>
  )
}
