// Reference 18: shared visuals; Base UI primitives retain interaction semantics.
export const menuPopupStyles =
  "relative max-h-(--available-height) max-w-(--available-width) origin-(--transform-origin) animate-none overflow-x-hidden overflow-y-auto rounded-2xl bg-popover/70 p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 dark:ring-foreground/10"

export const menuItemStyles =
  "h-7.5 min-h-7 gap-1.5 rounded-xl px-2 py-1.5 type-control whitespace-nowrap [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
