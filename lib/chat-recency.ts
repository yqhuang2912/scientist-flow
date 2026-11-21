import { format, isSameDay, isSameYear } from "date-fns"
import type { ChatTurnAck } from "./chat-job"

export const CHAT_ACCEPTED_EVENT = "scientistflow:chat-accepted"
export type ChatAcceptedDetail = Pick<
  ChatTurnAck,
  "acceptedAt" | "lastMessagePreview"
> & {
  chatId: string
}

export function mergeChatAcceptance(
  previous: Record<string, ChatAcceptedDetail>,
  update: ChatAcceptedDetail
) {
  if (previous[update.chatId]?.acceptedAt >= update.acceptedAt) return previous
  return { ...previous, [update.chatId]: update }
}

export function chatTimeLabels(date: Date, now = new Date()) {
  return {
    lastMessageAtLabel: format(
      date,
      isSameDay(date, now)
        ? "HH:mm"
        : isSameYear(date, now)
          ? "MMM d"
          : "yyyy-MM-dd"
    ),
    lastMessageAtTitle: format(date, "yyyy-MM-dd HH:mm xxx"),
  }
}
