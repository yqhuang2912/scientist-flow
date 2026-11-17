import { cn } from "@/lib/utils"

/** Compact, single-line bot identity shared by chat and selection surfaces. */
export function BotName({
  name,
  job,
  className,
}: {
  name: string
  job?: string | null
  className?: string
}) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-baseline gap-2", className)}
      title={job ? `${name} — ${job}` : name}
    >
      <span className={cn("truncate", job && "max-w-[60%] shrink-0")}>
        {name}
      </span>
      {job && (
        <span className="truncate text-[12px] font-normal text-muted-foreground">
          {job}
        </span>
      )}
    </span>
  )
}
