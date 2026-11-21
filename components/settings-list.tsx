"use client"

import type { ReactNode } from "react"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  compactItemStyles,
  compactListStyles,
} from "@/components/ui/compact-styles"
import { cn } from "@/lib/utils"

export function SettingsListHeader({
  title,
  description,
  noun,
  search,
  searchLabel = "Search " + title.toLowerCase(),
  onSearch,
  onCreate,
}: {
  title: string
  description: string
  noun?: string
  search: string
  searchLabel?: string
  onSearch: (query: string) => void
  onCreate?: () => void
}) {
  return (
    <>
      <div>
        <h2 className="type-section-title">{title}</h2>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel + "…"}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        {onCreate && (
          <Button size="sm" onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            New {noun}
          </Button>
        )}
      </div>
    </>
  )
}

export function SettingsListEmpty({
  label,
  icon,
}: {
  label: string
  icon: ReactNode
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{label}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}

export function SettingsList({
  items,
  emptyLabel,
  icon,
}: {
  items: {
    id: string
    name: string
    description: string
    icon: ReactNode
    onSelect: () => void
  }[]
  emptyLabel: string
  icon: ReactNode
}) {
  if (!items.length) return <SettingsListEmpty icon={icon} label={emptyLabel} />
  return (
    <ul className={compactListStyles}>
      {items.map((item) => (
        <li key={item.id}>
          <Button
            variant="ghost"
            onClick={item.onSelect}
            className={cn(
              compactItemStyles,
              "h-7.5 w-full justify-start text-left"
            )}
          >
            <span
              aria-hidden
              className="flex w-7 shrink-0 items-center justify-center"
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate" title={item.name}>
              {item.name}
            </span>
            <span
              className="max-w-1/3 truncate text-xs font-normal text-muted-foreground sm:max-w-[45%]"
              title={item.description}
            >
              {item.description}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}
