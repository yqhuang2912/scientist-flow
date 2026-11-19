"use client"
import { useState } from "react"
import { ChevronsUpDownIcon } from "lucide-react"
import {
  choiceProblem,
  connectionLabel,
  type ConnectionSummary,
  type CatalogModel,
  type ModelChoice,
  type Effort,
} from "@/lib/model-catalog"
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from "./ui/command"
import { Button } from "./ui/button"
import { NativeSelect } from "./ui/native-select"
import { Field, FieldLabel } from "./ui/field"

export function BotModelFields({
  connections,
  choice,
  onChange,
  manage,
}: {
  connections: ConnectionSummary[] | null
  choice: ModelChoice | null
  onChange: (value: ModelChoice | null) => void
  manage: () => void
}) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState("")
  const selected = connections?.find((c) => c.id === choice?.connectionId)
  const model = selected?.catalog.find((m) => m.id === choice?.modelId)
  const problem = connections && choice && choiceProblem(choice, selected)
  function accountLabel(c: ConnectionSummary) {
    return connectionLabel(c, connections ?? [])
  }
  function choose(connectionId: string, next: CatalogModel) {
    const effort =
      next.fixedEffort ??
      (choice?.effort && next.efforts.includes(choice.effort)
        ? choice.effort
        : null)
    setNotice(
      choice?.effort && !effort && next.efforts.length
        ? "Choose an effort for this model."
        : ""
    )
    onChange({ connectionId, modelId: next.id, effort })
    setOpen(false)
  }
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <Field data-invalid={!!problem}>
          <FieldLabel htmlFor="bot-model">Model</FieldLabel>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              id="bot-model"
              disabled={!connections}
              aria-invalid={!!problem}
              aria-label="Select model"
              render={
                <Button
                  type="button"
                  variant="secondary"
                  className="min-w-0 justify-between"
                />
              }
            >
              <span className="truncate">
                {!connections
                  ? "Loading models…"
                  : choice
                    ? (selected
                        ? accountLabel(selected)
                        : "Unavailable connection") +
                      " · " +
                      (model?.name ?? choice.modelId)
                    : "Needs configuration"}
              </span>
              <ChevronsUpDownIcon />
            </PopoverTrigger>
            <PopoverContent className="w-[min(28rem,85vw)] p-0">
              <Command>
                <CommandInput placeholder="Search models or connections…" />
                <CommandList>
                  <CommandEmpty>No matching models.</CommandEmpty>
                  {connections
                    ?.filter((c) => c.state === "ready")
                    .map((c) => (
                      <CommandGroup
                        key={c.id}
                        heading={
                          (c.provider === "chatgpt"
                            ? "ChatGPT"
                            : "Custom gateway") +
                          " · " +
                          accountLabel(c)
                        }
                      >
                        {c.catalog.map((m) => (
                          <CommandItem
                            key={m.id}
                            value={[
                              c.id,
                              c.nickname,
                              c.baseUrl,
                              m.id,
                              m.name,
                            ].join(" ")}
                            disabled={!!m.unavailable}
                            onSelect={() => choose(c.id, m)}
                          >
                            <span className="min-w-0">
                              <span className="block truncate">{m.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {accountLabel(c)} · {m.id}
                                {m.unavailable && " · " + m.unavailable}
                              </span>
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Field>

        <Field>
          <FieldLabel htmlFor="bot-effort">Reasoning</FieldLabel>
          <NativeSelect
            id="bot-effort"
            disabled={!model || !model.efforts.length || !!model.fixedEffort}
            value={model?.fixedEffort ?? choice?.effort ?? ""}
            onChange={(e) => {
              if (!choice) return
              setNotice("")
              onChange({
                ...choice,
                effort: (e.target.value || null) as Effort | null,
              })
            }}
          >
            <option value="" disabled>
              {!choice
                ? "Choose a model first"
                : !model
                  ? "Unavailable"
                  : model.efforts.length
                    ? "Select effort"
                    : (model.effortNote ?? "Levels unconfirmed")}
            </option>
            {choice?.effort && !model?.efforts.includes(choice.effort) && (
              <option value={choice.effort} disabled>
                {choice.effort} (unavailable)
              </option>
            )}
            {model?.efforts.map((e) => (
              <option key={e} value={e}>
                {model?.fixedEffort ? "Fixed · " + e : e}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {(problem || connections?.length === 0) && (
        <div className="text-xs text-muted-foreground">
          {problem}{" "}
          <Button type="button" size="sm" variant="link" onClick={manage}>
            Manage models
          </Button>
        </div>
      )}
      {notice && (
        <p className="text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      )}
    </div>
  )
}
