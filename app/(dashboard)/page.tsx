import { nanoid } from "nanoid"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"

export const dynamic = "force-dynamic"

export default function Page() {
  const avatarSeed = nanoid()

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <Empty className="max-w-xl border-0 bg-transparent p-0">
        <EmptyHeader className="max-w-md gap-3">
          <EmptyMedia className="mb-1">
            <ChatAvatar seed={avatarSeed} animated className="size-9" />
          </EmptyMedia>
          <EmptyTitle size="welcome">Meet your first bot</EmptyTitle>
          <EmptyDescription className="max-w-sm text-sm leading-5 text-muted-foreground">
            Every bot gets its own personality, memory, and face. Spin one up
            and start the conversation.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="w-auto max-w-none">
          <BotDialog initialAvatarSeed={avatarSeed} />
        </EmptyContent>
      </Empty>
    </main>
  )
}
