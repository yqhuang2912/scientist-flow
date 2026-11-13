import Image from "next/image"
import { Avatar, Style } from "@dicebear/core"
import clay from "@dicebear/styles/clay.json"

import { cn } from "@/lib/utils"

const clayStyle = new Style(clay)

interface ChatAvatarProps {
  seed: string
  animated?: boolean
  className?: string
}

export function ChatAvatar({
  seed,
  animated = false,
  className,
}: ChatAvatarProps) {
  const avatar = new Avatar(clayStyle, {
    seed,
    animationVariant: animated ? "fast" : "none",
  })

  return (
    <Image
      src={avatar.toDataUri()}
      alt={`${seed} avatar`}
      width={32}
      height={32}
      className={cn("size-8", className)}
      unoptimized
    />
  )
}
