import { format, isSameDay, isSameYear } from "date-fns"

export const CHAT_ACCEPTED_EVENT = "scientistflow:chat-accepted"

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
