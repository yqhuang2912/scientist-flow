"use client"

import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import type { SkillSummary } from "@/db/schema"

export function BotSkillPicker({
  options,
  ids,
  onChange,
  disabled,
  error,
  validationError,
  onRetry,
  onManage,
}: {
  options: SkillSummary[] | null
  ids: string[]
  onChange: (ids: string[]) => void
  disabled: boolean
  error: string
  validationError?: string
  onRetry: () => void
  onManage: () => void
}) {
  const [query, setQuery] = useState("")
  const prefix = useId()
  const visible = options?.filter((s) =>
    [s.displayName, s.name, s.description].some((v) =>
      v?.toLowerCase().includes(query.trim().toLowerCase())
    )
  )
  return (
    <Field data-invalid={!!validationError}>
      <div className="flex items-center justify-between">
        <FieldTitle>Skills</FieldTitle>
        {options && (
          <span className="text-xs text-muted-foreground">
            {ids.length} selected
          </span>
        )}
      </div>
      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-destructive"
        >
          {error}
          <Button variant="outline" size="compact" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : !options ? (
        <span
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Spinner />
          Loading skills…
        </span>
      ) : options.length === 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit!"
          onClick={onManage}
        >
          Manage shared skills
        </Button>
      ) : (
        <>
          <Input
            type="search"
            aria-label="Search skills"
            placeholder="Search skills…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div
            className="max-h-40 overflow-y-auto"
            role="group"
            aria-label="Available skills"
          >
            {visible?.map((s) => (
              <FieldLabel
                key={s.id}
                htmlFor={prefix + s.id}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 hover:bg-highlight"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate">{s.displayName || s.name}</span>
                    {s.displayName && (
                      <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                        {s.name}
                      </span>
                    )}
                  </span>
                  <span
                    className="block truncate text-xs font-normal text-muted-foreground"
                    title={s.description}
                  >
                    {s.description}
                  </span>
                </span>
                <Checkbox
                  id={prefix + s.id}
                  aria-label={s.displayName || s.name}
                  aria-invalid={!!validationError}
                  disabled={disabled}
                  checked={ids.includes(s.id)}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked ? [...ids, s.id] : ids.filter((id) => id !== s.id)
                    )
                  }
                />
              </FieldLabel>
            ))}
            {!visible?.length && (
              <p className="p-2 text-xs text-muted-foreground">
                No matching skills.
              </p>
            )}
          </div>
        </>
      )}
      {validationError && <FieldError>{validationError}</FieldError>}
    </Field>
  )
}
