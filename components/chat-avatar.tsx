"use client"

import Image from "next/image"
import { Avatar, Style } from "@dicebear/core"
import gaze from "@dicebear/styles/gaze.json"

import { cn } from "@/lib/utils"

const gazeStyle = new Style(gaze)

interface ChatAvatarProps {
  seed: string
  animated?: boolean
  className?: string
  alt?: string
}

export function ChatAvatar({
  seed,
  animated = false,
  className,
  alt,
}: ChatAvatarProps) {
  const avatar = new Avatar(gazeStyle, {
    seed,
    animationVariant: animated ? "fast" : "none",
  })

  return (
    <Image
      src={avatar.toDataUri()}
      alt={alt ?? `${seed} avatar`}
      width={32}
      height={32}
      className={cn("size-8", className)}
      unoptimized
    />
  )
}
