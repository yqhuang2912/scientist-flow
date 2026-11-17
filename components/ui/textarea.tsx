import * as React from "react"
import { cn } from "cn"

function Textarea({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"textarea"> & { variant?: "default" | "document" }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        variant === "document"
          ? "block field-sizing-fixed size-full resize-none border-0 bg-background p-6 font-mono text-[13px] leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          : "flex field-sizing-content min-h-16 w-full rounded-2xl border border-transparent bg-input/50 px-2.5 py-2 type-control-compact transition-[color,box-shadow] duration-200 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 motion-reduce:transition-none max-md:text-[16px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
