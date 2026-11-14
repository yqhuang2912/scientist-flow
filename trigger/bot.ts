import { eq } from "drizzle-orm"

import { bots } from "../db/schema"
import { db } from "../lib/db"

export async function getTriggerBotById(botId: string) {
  const rows = await db.select().from(bots).where(eq(bots.id, botId)).limit(1)
  return rows[0] ?? null
}
