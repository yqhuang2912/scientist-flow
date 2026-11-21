import type { ChatJobState } from "./chat-job"

export type ChatActivityRow = {
  chatId: string
  turnId: string
  state: ChatJobState
  waiting: boolean
  hasReply: boolean
}
export type ChatMarker = "running" | "waiting" | "unread"

export function chatMarker(
  row: ChatActivityRow,
  seen: string | null
): ChatMarker | undefined {
  if (row.state === "running" || row.state === "queued")
    return row.waiting ? "waiting" : "running"
  if (row.state === "completed" && row.hasReply && row.turnId !== seen)
    return "unread"
}
export const CHAT_ACTIVITY_CHANGED = "scientistflow:chat-activity-changed"
export const CHAT_REMOTE_TURN = "scientistflow:remote-turn"
