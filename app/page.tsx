import { nanoid } from "nanoid"
import { Plus } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { ChatAvatar } from "@/components/chat-avatar"

export const dynamic = "force-dynamic"

export default function Page() {
  const avatarSeed = nanoid()

  return (
    <main className="dark flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <Empty className="max-w-xl border-0 bg-transparent p-0">
        <EmptyHeader className="max-w-md gap-3">
          <EmptyMedia className="mb-1">
            <ChatAvatar seed={avatarSeed} animated className="size-9" />
          </EmptyMedia>
          <EmptyTitle className="text-sm font-semibold tracking-normal">
            Meet your first bot
          </EmptyTitle>
          <EmptyDescription className="max-w-sm text-sm leading-5 text-muted-foreground">
            Every bot gets its own personality, memory, and face. Spin one up
            and start the conversation.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="w-auto max-w-none">
          <Button variant="secondary" size="sm" className="rounded-md px-3">
            <Plus data-icon="inline-start" />
            Create a new bot
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}
