// Settings > Bots / Workspace is the reference for application controls.
// Body copy, document content and code keep their own readable typography.
export const compactItemTypography = "text-[13px] leading-5 font-medium"

export const compactItemStyles = `${compactItemTypography} min-h-7.5 gap-2 rounded-xl px-2.5 py-1 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`

export const compactListStyles = "flex flex-col gap-0.5"

// Standalone icon controls keep the same circular surface in every state.
export const iconButtonStyles = "aspect-square rounded-full p-0"

export const chatAvatarStyles = "size-7 shrink-0 rounded-lg"

// A 28 px portrait occupies the row's existing 20 px content line; its extra
// height uses the vertical padding instead of increasing the 30 px item height.
export const compactChatAvatarStyles = `${chatAvatarStyles} -my-1`

// Menus retain the equivalent focus/highlight state of their Base UI primitive.
export const compactItemStates =
  "hover:bg-highlight hover:text-foreground focus-visible:bg-highlight focus-visible:text-foreground data-active:bg-muted data-active:text-foreground"
