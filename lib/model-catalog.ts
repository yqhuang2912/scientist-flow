import { z } from "zod"

const routerEffort = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])
export const effortSchema = z
  .string()
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/)
export type Effort = z.infer<typeof effortSchema>
export const modelChoiceSchema = z
  .object({
    connectionId: z.nanoid(),
    modelId: z.string().trim().min(1).max(256),
    effort: effortSchema.nullable(),
  })
  .strict()
export type ModelChoice = z.infer<typeof modelChoiceSchema>
export type CatalogModel = {
  id: string
  name: string
  efforts: Effort[]
  unavailable: string | null
  fixedEffort?: Effort
  effortNote?: string
}
export type ConnectionState =
  | "ready"
  | "empty"
  | "invalid"
  | "catalog-error"
  | "disconnected"
  | "identity-only"
  | "limited"
  | "restricted"
export type ModelProvider = "openrouter" | "chatgpt"
export type ConnectionSummary = {
  provider?: ModelProvider
  usedBy?: string[]
  needsModelChange?: string[]
  id: string
  nickname: string
  revision: string
  state: ConnectionState
  catalog: CatalogModel[]
}
export const connectionStatus: Record<ConnectionState, string> = {
  ready: "Connected",
  "identity-only": "Signed in · plan permission required",
  limited: "Plan usage limit reached",
  restricted: "Account or workspace restriction",
  empty: "No models visible to this account",
  invalid: "Authorization is invalid",
  "catalog-error": "Could not load the model catalog",
  disconnected: "Disconnected",
}

const routerModel = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  architecture: z
    .object({
      output_modalities: z.array(z.string()).nullish(),
      input_modalities: z.array(z.string()).nullish(),
    })
    .nullish(),
  reasoning: z
    .object({
      supported_efforts: z.array(z.string()).nullish(),
      mandatory: z.boolean().optional(),
      default_effort: z.string().nullish(),
    })
    .nullish(),
})
export function parseCatalog(input: unknown): CatalogModel[] {
  return z
    .object({ data: z.array(routerModel) })
    .parse(input)
    .data.map((m) => {
      const params = m.supported_parameters
      const text = [
        m.architecture?.input_modalities,
        m.architecture?.output_modalities,
      ].every((list) => !list || list.includes("text"))
      const unavailable = !text
        ? "Not a text chat model"
        : params && !params.includes("tools")
          ? "Tool calls unsupported"
          : null
      // The user catalog distinguishes general reasoning support from exact levels.
      const declared = m.reasoning?.supported_efforts
      const efforts = (
        declared === null ? routerEffort.options : (declared ?? [])
      ).filter(
        (e): e is Effort =>
          routerEffort.safeParse(e).success &&
          !(e === "none" && m.reasoning?.mandatory)
      )
      const fixedEffort =
        efforts.length === 1 &&
        m.reasoning?.mandatory &&
        m.reasoning.default_effort === efforts[0]
          ? efforts[0]
          : undefined
      return {
        fixedEffort,
        id: m.id,
        name: m.name || m.id,
        efforts: [...new Set(efforts)],
        unavailable,
        effortNote: efforts.length
          ? undefined
          : m.reasoning
            ? "No selectable effort"
            : params && !params.includes("reasoning")
              ? "Not supported"
              : "Levels unconfirmed",
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
export function choiceProblem(
  choice: ModelChoice,
  connection?: ConnectionSummary | null
) {
  if (!connection || connection.id !== choice.connectionId)
    return "This connection is unavailable to this installation."
  if (connection.state !== "ready")
    return connectionStatus[connection.state] + ". Check Model connections."
  const model = connection.catalog.find((m) => m.id === choice.modelId)
  if (!model) return "This model is no longer in the connection’s catalog."
  if (model.unavailable) return model.unavailable + "."
  if (model.efforts.length && !model.fixedEffort && !choice.effort)
    return "Select a reasoning effort for this model."
  if (choice.effort && !model.efforts.includes(choice.effort))
    return "This reasoning effort is unavailable for the selected model."
  return null
}
