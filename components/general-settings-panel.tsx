"use client"

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"

import { SettingsRow } from "@/components/settings-shell"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const themeOptions = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
]

const subscribe = () => () => {}

export function GeneralSettingsPanel() {
  const { theme, setTheme, forcedTheme } = useTheme()
  // The saved preference is only available in the browser. Keep the server
  // render and first hydration render identical without hiding the whole row.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )

  return (
    <section
      className="flex min-w-0 flex-col p-4"
      aria-labelledby="general-settings-title"
    >
      <h2 id="general-settings-title" className="pr-8 text-[13px] font-medium">
        General
      </h2>
      <SettingsRow
        label="Theme"
        description="Choose how the interface looks."
        className="flex-row items-center"
        control={
          <Select
            items={themeOptions}
            value={hydrated ? (forcedTheme ?? theme ?? null) : null}
            disabled={!hydrated || !!forcedTheme}
            onValueChange={(value) => {
              if (
                value &&
                themeOptions.some((option) => option.value === value)
              )
                setTheme(value)
            }}
          >
            <SelectTrigger
              variant="secondary"
              className="w-28"
              aria-label="Theme"
            >
              <SelectValue placeholder="Theme" />
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectGroup>
                {themeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />
    </section>
  )
}
