import { nanoid } from "nanoid"
import { relations } from "drizzle-orm"
import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"

export const skills = pgTable("skills", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name").notNull().unique(),
  displayName: text("display_name"),
  description: text("description").notNull(),
  instructions: text("instructions").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const skillNameSchema = z
  .string()
  .min(1, "Enter a skill identifier.")
  .max(64, "Use 64 characters or fewer.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens between words."
  )

export const skillFormSchema = createInsertSchema(skills, {
  name: skillNameSchema,
  displayName: z
    .string()
    .trim()
    .nullish()
    .transform((value) => value || null),
  description: z
    .string()
    .trim()
    .min(1, "Describe when to use this skill.")
    .max(1024, "Use 1,024 characters or fewer."),
  instructions: z
    .string()
    .refine((value) => value.trim().length > 0, "Enter Markdown instructions.")
    .refine((value) => {
      const header = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
        value.trimStart()
      )
      return !header || !/^(?:name|description):/m.test(header[1])
    }, "Enter the instructions only. The skill header is generated for you."),
})
  .pick({
    name: true,
    displayName: true,
    description: true,
    instructions: true,
  })
  .strict()

export type Skill = typeof skills.$inferSelect
export type SkillSummary = Omit<Skill, "instructions" | "createdAt">
export type SkillInput = z.input<typeof skillFormSchema>
export type SkillValues = z.output<typeof skillFormSchema>

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

export const chatKind = pgEnum("chat_kind", ["direct", "group"])

export const botSkills = pgTable(
  "bot_skills",
  {
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.botId, table.skillId] }),
    index("bot_skills_skill_id_idx").on(table.skillId),
  ]
)

export const chats = pgTable("chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  kind: chatKind("kind").notNull().default("direct"),
  name: text("name"),
  lastMessagePreview: text("last_message_preview"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const chatMembers = pgTable(
  "chat_members",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.botId] }),
    index("chat_members_bot_id_idx").on(table.botId),
  ]
)

export const botsRelations = relations(bots, ({ many }) => ({
  memberships: many(chatMembers),
}))

export const chatsRelations = relations(chats, ({ many }) => ({
  members: many(chatMembers),
}))

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  chat: one(chats, {
    fields: [chatMembers.chatId],
    references: [chats.id],
  }),
  bot: one(bots, {
    fields: [chatMembers.botId],
    references: [bots.id],
  }),
}))

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
    skillIds: z.array(z.nanoid()).transform((ids) => [...new Set(ids)]),
  })
  .strict()

export const insertTaskSchema = createInsertSchema(chats, {
  name: z.string().trim().min(1, "Name is required"),
})

export const taskFormSchema = insertTaskSchema.pick({ name: true }).extend({
  botIds: z.array(z.string().min(1)).min(1, "Select at least one bot"),
})

export type BotFormValues = z.infer<typeof botFormSchema>
export type TaskFormValues = z.infer<typeof taskFormSchema>
