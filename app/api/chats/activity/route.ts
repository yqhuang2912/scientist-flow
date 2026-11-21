import { desc, eq, sql } from "drizzle-orm"
import { chatTurns as t } from "@/db/schema"
import { db } from "@/lib/db"
import { assertInstallationRequest } from "@/lib/installation-request.server"
import {
  installationOwner,
  ModelConnectionError,
} from "@/lib/model-credentials.server"
import type { ChatActivityRow } from "@/lib/chat-activity-status"

export async function GET() {
  try {
    await assertInstallationRequest()
    if (!process.env.SCIENTISTFLOW_INSTALLATION_ID) return Response.json([])
    const latest = db
      .selectDistinctOn([t.chatId], {
        chatId: t.chatId,
        turnId: t.id,
        state: t.state,
        user: t.userMessage,
        replies: t.replies,
      })
      .from(t)
      .where(eq(t.owner, installationOwner()))
      .orderBy(
        t.chatId,
        desc(sql`${t.state} in ('running', 'queued')`),
        desc(
          sql`case when starts_with(${t.id}, 'workflow_') then coalesce((${t.userMessage} #>> '{metadata,restartedAt}')::timestamptz, ${t.createdAt}) else ${t.createdAt} end`
        ),
        desc(t.id)
      )
      .as("latest_turn")
    const rows: ChatActivityRow[] = await db.select({
      chatId: latest.chatId,
      turnId: latest.turnId,
      state: latest.state,
      waiting: sql<boolean>`case when ${latest.state} = 'running' then coalesce(${latest.user} #>> '{metadata,checkpoint,phase}' = 'waiting', false) else false end`,
      hasReply: sql<boolean>`case when ${latest.state} = 'completed' then jsonb_array_length(${latest.replies}) > 0 else false end`,
    }).from(latest)
    return Response.json(rows, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return new Response("Could not read chat activity.", {
      status: error instanceof ModelConnectionError ? 403 : 500,
    })
  }
}
