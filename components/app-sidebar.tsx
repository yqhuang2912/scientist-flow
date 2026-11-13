"use client"

import { useEffect, useState } from "react"
import { nanoid } from "nanoid"
import { BotIcon, PlusIcon, SearchIcon, UsersIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import type { SidebarChat } from "@/queries/bots"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Kbd, KbdGroup } from "@/components/ui/kbd"

const searchButtonClasses =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base font-normal transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"

export function AppSidebar({ chats }: { chats: SidebarChat[] }) {
  const router = useRouter()
  const [botDialogOpen, setBotDialogOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [avatarSeed] = useState(() => nanoid())

  function handleChatSelect(chatId: string) {
    setSearchOpen(false)
    router.push(`/chats/${chatId}`)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "x"
      ) {
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return
      }

      event.preventDefault()
      setSearchOpen(true)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <>
      <Sidebar className="group-data-[side=left]:border-r-0">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton
                      aria-label="Create"
                      size="lg"
                      className="size-10 justify-center p-0"
                    />
                  }
                >
                  <PlusIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  side="right"
                  sideOffset={8}
                  className="dark min-w-52"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setBotDialogOpen(true)}>
                      <BotIcon data-icon="inline-start" />
                      Create new bot
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <UsersIcon data-icon="inline-start" />
                      Create group chat
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Button
                type="button"
                variant="ghost"
                className={`${searchButtonClasses} justify-start gap-2 text-muted-foreground hover:text-foreground`}
                onClick={() => setSearchOpen(true)}
              >
                <SearchIcon data-icon="inline-start" />
                <span>Search chats</span>
                <KbdGroup className="ml-auto">
                  <Kbd>⌘</Kbd>
                  <Kbd>X</Kbd>
                </KbdGroup>
              </Button>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {chats.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      render={<button type="button" />}
                      className="h-auto min-h-12 items-start p-2"
                      onClick={() => handleChatSelect(chat.id)}
                    >
                      <ChatAvatar
                        seed={chat.bot?.avatar ?? chat.id}
                        alt={`${chat.name} avatar`}
                        className="size-10 shrink-0 rounded-xl"
                      />
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                        <span className="w-full truncate font-medium">
                          {chat.name}
                        </span>
                        <span className="w-full truncate text-xs text-sidebar-foreground/70">
                          {chat.lastMessagePreview}
                        </span>
                      </span>
                      <time className="shrink-0 text-xs text-sidebar-foreground/70">
                        {chat.lastMessageAtLabel}
                      </time>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <BotDialog
        initialAvatarSeed={avatarSeed}
        open={botDialogOpen}
        onOpenChange={setBotDialogOpen}
        showTrigger={false}
      />
      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search chats"
        description="Search your chats"
        className="dark sm:max-w-lg"
      >
        <Command>
          <CommandInput placeholder="Search chats..." />
          <CommandList>
            <CommandEmpty>No chats found.</CommandEmpty>
            <CommandGroup heading="Chats">
              {chats.map((chat) => (
                <CommandItem
                  key={chat.id}
                  value={`${chat.name} ${chat.lastMessagePreview}`}
                  onSelect={() => handleChatSelect(chat.id)}
                >
                  <ChatAvatar
                    seed={chat.bot?.avatar ?? chat.id}
                    alt={`${chat.name} avatar`}
                    className="size-8 rounded-lg"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">{chat.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {chat.lastMessagePreview}
                    </span>
                  </span>
                  <CommandShortcut>{chat.lastMessageAtLabel}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
