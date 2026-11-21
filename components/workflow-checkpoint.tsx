"use client"

import { useId, useState } from "react"
import { Button } from "./ui/button"
import { ChatMentionInput } from "./chat-mention-input"
import { mentionTargets, type Mention } from "@/lib/chat-mentions"
import type { ChatWithBot } from "@/queries/chats"
import type {
  CheckpointCommand,
  WorkflowCheckpoint,
} from "@/lib/workflow-checkpoint"

export function WorkflowCheckpointPanel({
  bots,
  checkpoint,
  disabled,
  reviewed,
  beforeStart,
  change,
}: {
  bots: ChatWithBot["bots"]
  checkpoint: WorkflowCheckpoint
  disabled: boolean
  beforeStart: boolean
  reviewed: boolean
  change: (command: CheckpointCommand) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const inputId = useId()
  const [mentions, setMentions] = useState<Mention[]>([])
  const [draft, setDraft] = useState("")
  const { phase, note } = checkpoint
  const writable = ["open", "armed", "waiting"].includes(phase) && !disabled
  return (
    <section aria-label="人工介入" className="border-t pt-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto font-medium">
          子集实验 → 人工介入 → 实验评判
        </span>
        {writable && phase === "open" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void change({ action: "pause" })}
          >
            在此暂停
          </Button>
        )}
        {writable && phase !== "open" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void change({ action: "continue" })}
          >
            {phase === "waiting" ? "继续评判" : "直接放行"}
          </Button>
        )}
        {writable && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            补充要求
          </Button>
        )}
      </div>
      <p role="status" className="mt-1 text-xs text-muted-foreground">
        {phase === "waiting"
          ? "已暂停。提交补充要求，或直接继续评判。"
          : phase === "armed"
            ? "已预约暂停。子集实验完成后会在这里等待。"
            : phase === "passed"
              ? note
                ? reviewed
                  ? "评判节点已核对原报告和补充报告。"
                  : "已接收补充要求，完成后继续评判。"
                : "已直接放行至实验评判。"
              : phase === "released" && note
                ? "已保存要求，子集实验后先执行补充实验。"
                : "子集实验完成后自动进入评判。"}
      </p>
      {note && beforeStart && (
        <p className="mt-1 break-words whitespace-pre-wrap">{note}</p>
      )}
      {editing && writable && (
        <form
          className="mt-2 grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (
              draft.trim() &&
              (await change({
                action: "submit",
                note: draft.trim(),
                mentionedBotIds: mentionTargets(mentions).mentionedBotIds,
              }))
            ) {
              setDraft("")
              setMentions([])
              setEditing(false)
            }
          }}
        >
          <div className="flex min-w-0 flex-col">
            <ChatMentionInput
              id={inputId}
              bots={bots}
              value={draft}
              mentions={mentions}
              fieldLabel="本次补充要求"
              maxLength={4000}
              change={(text, next) => {
                setDraft(text)
                setMentions(next)
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              取消
            </Button>
            <Button type="submit" size="sm" disabled={!draft.trim()}>
              提交补充要求
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
