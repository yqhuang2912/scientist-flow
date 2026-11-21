import { nanoid } from "nanoid"
import { relations, sql } from "drizzle-orm"
import type { HttpToolConfig, ToolInputSchema } from "../lib/tool-definition"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"
import {
  gatewayBaseUrlSchema,
  modelChoiceSchema,
  type CatalogModel,
  type ModelProvider,
  type ConnectionState,
  type ModelChoice,
} from "../lib/model-catalog"

import type { ChatJobState } from "../lib/chat-job"
import type { WorkflowDraft } from "../lib/workflow-draft"
import type { UIMessage } from "ai"
import type { ToolEvidence } from "../lib/project-decisions"
import type { ExecutionStatus, Delegation } from "../lib/bot-execution"

export const modelConnections = pgTable(
  "model_connections",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    provider: text("provider")
      .$type<ModelProvider>()
      .notNull()
      .default("openrouter"),
    nickname: text("nickname").notNull(),
    baseUrl: text("base_url"),
    revision: text("revision").notNull(),
    credential: text("credential"),
    state: text("state").$type<ConnectionState>().notNull(),
    catalog: jsonb("catalog").$type<CatalogModel[]>().notNull(),
  },
  (t) => [index("model_connections_owner_idx").on(t.owner)]
)

export const connectionFormSchema = createInsertSchema(modelConnections, {
  baseUrl: gatewayBaseUrlSchema,
})
  .pick({ baseUrl: true })
  .extend({
    apiKey: z.string().trim().max(1024),
  })
  .strict()

export const profileNameSchema = createInsertSchema(modelConnections, {
  nickname: z.string().trim().min(1, "Enter a nickname.").max(80),
})
  .pick({ nickname: true })
  .strict()

export const modelRequests = pgTable(
  "model_requests",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    runId: text("run_id").notNull(),
    executionId: text("execution_id"),
    step: integer("step").notNull(),
    botId: text("bot_id").notNull(),
    connection: text("connection").notNull(),
    revision: text("revision"),
    model: text("model").notNull(),
    effort: text("effort"),
    httpStatus: integer("http_status"),
    outcome: text("outcome"),
    responseModel: text("response_model"),
    responseId: text("response_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("model_requests_chat_idx").on(t.chatId)]
)

export const toolDefinitions = pgTable("tools", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name").notNull().unique(),
  displayName: text("display_name"),
  description: text("description").notNull(),
  kind: text("kind", { enum: ["http"] }).notNull(),
  inputSchema: jsonb("input_schema").$type<ToolInputSchema>().notNull(),
  config: jsonb("config").$type<HttpToolConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})
export type ToolDefinition = typeof toolDefinitions.$inferSelect
export type ToolSummary = Omit<
  ToolDefinition,
  "config" | "inputSchema" | "createdAt"
>

export const taskTemplates = pgTable("task_templates", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  workflowDraft: jsonb("workflow_draft").$type<WorkflowDraft>(),
  draftRevision: integer("draft_revision").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const taskTemplateFormSchema = createInsertSchema(taskTemplates, {
  name: z.string().trim().min(1, "Enter a template name."),
  description: z.string().trim().optional().default(""),
})
  .pick({ name: true, description: true })
  .strict()

export type TaskTemplateSummary = Pick<
  typeof taskTemplates.$inferSelect,
  "id" | "name" | "description"
>

export const taskTemplateVersions = pgTable(
  "task_template_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    templateId: text("template_id")
      .notNull()
      .references(() => taskTemplates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    draftRevision: integer("draft_revision").notNull(),
    name: text("name").notNull(),
    workflow: jsonb("workflow").$type<WorkflowDraft>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("template_version_number").on(table.templateId, table.version),
    uniqueIndex("template_published_revision").on(
      table.templateId,
      table.draftRevision
    ),
  ]
)

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

// The editor treats the name as the primary field and derives the identifier
// from it, so the storage schema's optional display name does not apply here.
// Storage keeps it nullable because SKILL.md only carries name and description.
export const skillEditorSchema = skillFormSchema.extend({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter a name.")
    .max(160, "Use 160 characters or fewer."),
})

export type SkillEditorInput = z.input<typeof skillEditorSchema>
export type SkillEditorValues = z.output<typeof skillEditorSchema>

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
  modelChoice: jsonb("model_choice").$type<ModelChoice>(),
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

export const botTools = pgTable(
  "bot_tools",
  {
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    toolId: text("tool_id")
      .notNull()
      .references(() => toolDefinitions.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.botId, table.toolId] }),
    index("bot_tools_tool_id_idx").on(table.toolId),
  ]
)

export const chats = pgTable("chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  kind: chatKind("kind").notNull().default("direct"),
  // Assigned only when provisioning the installation's new, empty pilot chat.
  nativeOwner: text("native_owner").unique(),
  templateVersionId: text("template_version_id").references(
    () => taskTemplateVersions.id,
    { onDelete: "restrict" }
  ),
  researchBrief: text("research_brief"),
  name: text("name"),
  lastMessagePreview: text("last_message_preview"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const chatTurns = pgTable(
  "chat_turns",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    owner: text("owner").notNull(),
    inputHash: text("input_hash").notNull(),
    userMessage: jsonb("user_message").$type<UIMessage>().notNull(),
    replies: jsonb("replies").$type<UIMessage[]>().notNull().default([]),
    state: text("state").$type<ChatJobState>().notNull().default("queued"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    lease: text("lease"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.id] }),
    uniqueIndex("chat_turns_active_idx")
      .on(t.chatId)
      .where(sql`${t.state} in ('queued','running')`),
    index("chat_turns_worker_idx").on(t.owner, t.state, t.leaseUntil),
  ]
)

export const botMemoryLimit = 12

export const botExecutions = pgTable(
  "bot_executions",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userMessageId: text("user_message_id").notNull(),
    userText: text("user_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    slot: integer("slot").notNull(),
    runId: text("run_id").notNull(),
    botId: text("bot_id").notNull(),
    messageId: text("message_id").notNull().unique(),
    parentExecutionId: text("parent_execution_id"),
    status: text("status").$type<ExecutionStatus>().notNull(),
    delegation: jsonb("delegation").$type<Delegation>(),
    message: jsonb("message").$type<UIMessage>(),
  },
  (t) => [
    uniqueIndex("bot_execution_turn_slot_idx").on(
      t.chatId,
      t.userMessageId,
      t.slot
    ),
  ]
)

export const projectDecisions = pgTable(
  "project_decisions",
  {
    id: text("id")
      .primaryKey()
      .default(
        sql`'D-' || left(replace(gen_random_uuid()::text, '-', ''), 16)`
      ),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    nextStep: text("next_step"),
    creatorBotId: text("creator_bot_id").references(() => bots.id, {
      onDelete: "set null",
    }),
    creatorName: text("creator_name").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    sourcePart: integer("source_part"),
    toolEvidence: jsonb("tool_evidence").$type<ToolEvidence>(),
    sourceRole: text("source_role", { enum: ["user", "assistant"] }).notNull(),
    sourceAuthor: text("source_author").notNull(),
    quote: text("quote").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("project_decisions_source_decision_idx").on(
      table.chatId,
      table.fingerprint
    ),
  ]
)

export type ProjectDecision = Omit<
  typeof projectDecisions.$inferSelect,
  "fingerprint"
>
export const botMemoryTextLimit = 240

export const botMemories = pgTable(
  "bot_memories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    sourceChatId: text("source_chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    sourceMessageId: text("source_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("bot_memories_bot_text_idx").on(t.botId, t.text)]
)

export const botMemoryFormSchema = createInsertSchema(botMemories, {
  text: z
    .string()
    .trim()
    .min(1, "Enter a preference to remember.")
    .refine(
      (value) => Array.from(value).length <= botMemoryTextLimit,
      `Choose one preference of ${botMemoryTextLimit} characters or fewer.`
    ),
})
  .pick({ text: true })
  .strict()

// An admitted POST is never dispatched again for the same user turn and arguments,
// including after an interrupted worker. No payloads or credentials are stored.
export const toolPostClaims = pgTable(
  "tool_post_claims",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    toolId: text("tool_id")
      .notNull()
      .references(() => toolDefinitions.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.messageId, t.toolId, t.inputHash] }),
  ]
)

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
    modelChoice: modelChoiceSchema
      .nullable()
      .refine(
        (value) => Boolean(value),
        "Select a model connection and model."
      ),
    avatar: z.string().min(1, "Face is required"),
    name: z.string().trim().min(1, "Name is required"),
    job: z.string().trim().min(1, "Job is required"),
    instructions: z.string().trim().optional(),
    toolIds: z.array(z.nanoid()).transform((ids) => [...new Set(ids)]),
    skillIds: z.array(z.nanoid()).transform((ids) => [...new Set(ids)]),
  })
  .strict()

export const insertTaskSchema = createInsertSchema(chats, {
  name: z.string().trim().min(1, "Name is required"),
})

export const taskFormSchema = insertTaskSchema
  .pick({ name: true })
  .extend({
    botIds: z.array(z.string().min(1)),
    templateVersionId: z.nanoid().optional(),
    researchBrief: z.string().trim().optional(),
  })
  .superRefine((task, ctx) => {
    if (task.templateVersionId) {
      if (!task.researchBrief)
        ctx.addIssue({
          code: "custom",
          path: ["researchBrief"],
          message: "Enter the research brief for this task.",
        })
    } else if (!task.botIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["botIds"],
        message: "Select at least one bot.",
      })
    }
  })

export type BotFormValues = z.infer<typeof botFormSchema>
export type TaskFormValues = z.infer<typeof taskFormSchema>
