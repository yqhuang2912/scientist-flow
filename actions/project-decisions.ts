"use server"

import { z } from "zod"
import { projectRecordId } from "@/lib/project-decisions"
import {
  readProjectDecisions,
  withdrawProjectDecision,
} from "@/lib/project-decisions.server"

export async function listProjectDecisions(chatId: string, recordId?: string) {
  try {
    if (
      !z.nanoid().safeParse(chatId).success ||
      !projectRecordId.optional().safeParse(recordId).success
    )
      throw new Error()
    return {
      success: true as const,
      rows: await readProjectDecisions(chatId, recordId),
    }
  } catch {
    return {
      success: false as const,
      error: "Could not load this project's decisions. Please retry.",
    }
  }
}
export async function withdrawDecision(chatId: string, id: string) {
  try {
    if (
      !z.nanoid().safeParse(chatId).success ||
      !projectRecordId.safeParse(id).success
    )
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
