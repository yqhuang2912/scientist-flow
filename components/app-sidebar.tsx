"use client"

import { useState } from "react"
import { nanoid } from "nanoid"
import { BotIcon, PlusIcon, UsersIcon } from "lucide-react"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import type { SidebarChat } from "@/queries/bots"
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

export function AppSidebar({ chats }: { chats: SidebarChat[] }) {
  const [botDialogOpen, setBotDialogOpen] = useState(false)
  const [avatarSeed] = useState(() => nanoid())

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
    </>
  )
}
