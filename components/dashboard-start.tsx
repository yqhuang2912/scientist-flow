"use client"

import { useState } from "react"
import { PlusIcon } from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { TaskDialog } from "@/components/task-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { BotSummary } from "@/queries/bots"

interface StartCopy {
  title: string
  description: string
  action: string
}

const withBots: StartCopy = {
  title: "Start a task",
  description:
    "Name the task, choose the bots that work on it, then ask your first question.",
  action: "New task",
}

const withoutBots: StartCopy = {
  title: "Add a bot first",
  description:
    "Every task runs with at least one bot. Create one and give it a job to do.",
  action: "Create a bot",
}

export function DashboardStart({
  bots,
  avatarSeed,
}: {
  bots: BotSummary[]
  avatarSeed: string
}) {
  const [taskOpen, setTaskOpen] = useState(false)
  const [botOpen, setBotOpen] = useState(false)
  const hasBots = bots.length > 0
  const copy = hasBots ? withBots : withoutBots

  return (
    <>
      <Empty className="max-w-xl flex-none p-0">
        <EmptyHeader className="gap-3">
          <EmptyMedia className="mb-1">
            {hasBots ? (
              <GroupChatAvatar
                bots={bots.slice(0, 3)}
                fallbackSeed={avatarSeed}
                animated
                alt=""
                className="size-9"
              />
            ) : (
              <ChatAvatar
                seed={avatarSeed}
                animated
                alt=""
                className="size-9"
              />
            )}
          </EmptyMedia>
          <EmptyTitle size="welcome">{copy.title}</EmptyTitle>
          <EmptyDescription className="max-w-sm">
            {copy.description}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() => (hasBots ? setTaskOpen(true) : setBotOpen(true))}
          >
            <PlusIcon data-icon="inline-start" />
            {copy.action}
          </Button>
        </EmptyContent>
      </Empty>

      <TaskDialog bots={bots} open={taskOpen} onOpenChange={setTaskOpen} />

      <BotDialog
        initialAvatarSeed={avatarSeed}
        open={botOpen}
        onOpenChange={setBotOpen}
        showTrigger={false}
      />
    </>
  )
}
