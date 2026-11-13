import { nanoid } from "nanoid"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"

export const bots = pgTable("bots", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name").notNull(),
  avatar: text("avatar")
    .notNull()
    .$defaultFn(() => nanoid()),
  job: text("job").notNull(),
  instructions: text("instructions"),
  sandboxId: text("sandbox_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type Bot = typeof bots.$inferSelect
export type NewBot = typeof bots.$inferInsert

export const insertBotSchema = createInsertSchema(bots, {
  name: (schema) => schema.trim().min(1, "Name is required"),
  job: (schema) => schema.trim().min(1, "Job is required"),
})

export const botFormSchema = insertBotSchema
  .pick({ avatar: true, name: true, job: true, instructions: true })
  .extend({
    avatar: z.string().min(1, "Face is required"),
    name: z.string().trim().min(1, "Name is required"),
    job: z.string().trim().min(1, "Job is required"),
    instructions: z.string().trim().optional(),
  })

export type BotFormValues = z.infer<typeof botFormSchema>
