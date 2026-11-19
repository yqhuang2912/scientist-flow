"use server"

import { z } from "zod"
import {
  readProjectDecisions,
  withdrawProjectDecision,
} from "@/lib/project-decisions.server"

export async function listProjectDecisions(chatId: string) {
  try {
    if (!z.nanoid().safeParse(chatId).success) throw new Error()
    return { success: true as const, rows: await readProjectDecisions(chatId) }
  } catch {
    return {
      success: false as const,
      error: "Could not load this project's decisions. Please retry.",
    }
  }
}
export async function withdrawDecision(chatId: string, id: string) {
  try {
    if (!z.nanoid().safeParse(chatId).success || !/^D-[a-f0-9]{16}$/.test(id))
      throw new Error()
    if (await withdrawProjectDecision(chatId, id))
      return { success: true as const }
    return {
      success: false as const,
      error: "This decision is no longer active in this project.",
    }
  } catch {
    return {
      success: false as const,
      error: "Could not withdraw this decision. Please retry.",
    }
  }
}
