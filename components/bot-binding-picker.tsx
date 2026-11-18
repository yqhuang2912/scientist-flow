"use client"

import { useId } from "react"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import type { SkillSummary } from "@/db/schema"

type Option = Pick<SkillSummary, "id" | "name" | "displayName" | "description">
const optionLabel = (option: Option) => option.displayName || option.name

export function BotBindingPicker({
  label,
  options,
  ids,
  onChange,
  disabled,
  error,
  validationError,
  onRetry,
  onManage,
}: {
  label: "Skills" | "Tools"
  options: Option[] | null
  ids: string[]
  onChange: (ids: string[]) => void
  disabled: boolean
  error: string
  validationError?: string
  onRetry: () => void
  onManage: () => void
}) {
  const id = useId()
  const selected = options?.filter((item) => ids.includes(item.id)) ?? []
  const selectedNames = selected.map(optionLabel).join(", ")
  const noun = label.toLowerCase()
  return (
    <Field className="min-w-0" data-invalid={!!validationError}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-destructive"
        >
          {error}
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={onRetry}
          >
            Retry
          </Button>
        </div>
      ) : !options ? (
        <span
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Spinner />
          Loading {noun}…
        </span>
      ) : (
        <Combobox
          multiple
          items={options}
          value={selected}
          disabled={disabled}
          itemToStringLabel={optionLabel}
          itemToStringValue={(item) => item.id}
          onValueChange={(items) =>
            onChange(items.map((item) => item.id).sort())
          }
          filter={(item, query) => {
            const search = query.trim().toLowerCase()
            return [item.displayName, item.name, item.description].some(
              (text) => text?.toLowerCase().includes(search)
            )
          }}
        >
          <ComboboxTrigger
            id={id}
            aria-label={label}
            title={selectedNames || undefined}
            aria-description={selectedNames || undefined}
            aria-invalid={!!validationError}
            aria-describedby={validationError ? id + "-error" : undefined}
            render={<Button type="button" variant="secondary" />}
            className="min-w-0 justify-between bg-input/50 px-2.5"
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {selected.length ? optionLabel(selected[0]) : "Select " + noun}
            </span>
            {selected.length > 1 && (
              <span className="text-xs text-muted-foreground">
                +{selected.length - 1}
              </span>
            )}
          </ComboboxTrigger>
          <ComboboxContent
            aria-label={"Select " + noun}
            className="w-[max(var(--anchor-width),16rem)] min-w-0"
          >
            <ComboboxInput
              showTrigger={false}
              aria-label={"Search " + noun}
              placeholder={"Search " + noun + "…"}
            />
            <ComboboxList aria-label={label}>
              {(item: Option) => (
                <ComboboxItem
                  key={item.id}
                  value={item}
                  aria-label={optionLabel(item)}
                >
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate">{optionLabel(item)}</span>
                      {item.displayName && item.displayName !== item.name && (
                        <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                          {item.name}
                        </span>
                      )}
                    </span>
                    <span
                      className="block truncate text-xs font-normal text-muted-foreground"
                      title={item.description}
                    >
                      {item.description}
                    </span>
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>
              {options.length ? (
                "No matching " + noun
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onManage}
                >
                  Manage shared {noun}
                </Button>
              )}
            </ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
      )}
      {validationError && (
        <FieldError id={id + "-error"}>{validationError}</FieldError>
      )}
    </Field>
  )
}
