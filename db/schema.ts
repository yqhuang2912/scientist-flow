import { nanoid } from "nanoid"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"

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
