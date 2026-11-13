"use server"

import { db } from "@/lib/db"
import { bots, insertBotSchema } from "@/db/schema"

type CreateBotResult =
  | { success: true; bot: typeof bots.$inferSelect }
  | { success: false; error: string }

export async function createBot(input: unknown): Promise<CreateBotResult> {
  const parsed = insertBotSchema.safeParse(input)

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form fields.",
    }
  }

  try {
    const [bot] = await db.insert(bots).values(parsed.data).returning()

    if (!bot) {
      return { success: false, error: "The bot could not be created." }
    }

    return { success: true, bot }
  } catch (error) {
    console.error("Failed to create bot", error)
    return { success: false, error: "The bot could not be created." }
  }
}
