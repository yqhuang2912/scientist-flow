"use server"

import { and, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { bots, taskTemplates } from "@/db/schema"
import { db } from "@/lib/db"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import { workflowDraftSchema } from "@/lib/workflow-draft"

export async function saveWorkflowDraft(
  id: string,
  revision: number,
  input: unknown
) {
  await assertInstallationRequest()
  const draft = workflowDraftSchema.safeParse(input)
  if (
    !z.nanoid().safeParse(id).success ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !draft.success
  )
    return {
      success: false as const,
      error: "Invalid workflow draft. Check the nodes and connections.",
    }
  try {
    const botIds = [...new Set(draft.data.nodes.map((node) => node.botId))]
    if (botIds.length) {
      const found = await db
        .select({ id: bots.id })
        .from(bots)
        .where(inArray(bots.id, botIds))
      if (found.length !== botIds.length)
        return {
          success: false as const,
          error:
            "A selected bot no longer exists. Remove its step before saving.",
        }
    }
    const [row] = await db
      .update(taskTemplates)
      .set({
        workflowDraft: draft.data,
        draftRevision: revision + 1,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(taskTemplates.id, id), eq(taskTemplates.draftRevision, revision))
      )
      .returning({ revision: taskTemplates.draftRevision })
    return row
      ? { success: true as const, revision: row.revision }
      : {
          success: false as const,
          error:
            "The template changed or was deleted. Reopen it to load the latest draft.",
        }
  } catch {
    return {
      success: false as const,
      error: "Could not save the draft. Please try again.",
    }
  }
}
