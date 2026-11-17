"use client"

import { useEffect, useState } from "react"
import { nanoid } from "nanoid"
import {
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  DiamondIcon,
  PanelLeftIcon,
} from "lucide-react"
import { usePathname, useRouter } from "next/navigation"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { GroupChatDialog } from "@/components/group-chat-dialog"
import type { BotSummary, SidebarChat } from "@/queries/bots"
import { cn } from "@/lib/utils"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { WorkspaceSettingsDialog } from "@/components/workspace-settings-dialog"

function isMac() {
  if (typeof navigator === "undefined") return false
  return /mac/i.test(navigator.platform)
}

function BrandHeader() {
  const { toggleSidebar, state } = useSidebar()
  const collapsed = state === "collapsed"

  return (
    <div
      className={cn(
        "flex h-14 shrink-0 items-center border-b border-sidebar-border px-3",
        collapsed ? "justify-center" : "justify-between"
      )}
    >
      {!collapsed && (
        <div className="flex items-center gap-2 min-w-0">
          <DiamondIcon className="size-4 shrink-0 text-foreground" strokeWidth={1.5} />
          <span className="truncate text-sm font-semibold tracking-tight">
            ScientistFlow
          </span>
        </div>
      )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle sidebar"
                onClick={toggleSidebar}
                className="shrink-0"
              />
            }
          >
            <PanelLeftIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "Expand sidebar" : "Collapse sidebar"}
          </TooltipContent>
        </Tooltip>
    </div>
  )
}

export function AppSidebar({
  chats,
  bots,
}: {
  chats: SidebarChat[]
  bots: BotSummary[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [botDialogOpen, setBotDialogOpen] = useState(false)
  const [groupChatDialogOpen, setGroupChatDialogOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false)
  const [avatarSeed] = useState(() => nanoid())
  const [mac] = useState(() => isMac())

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
        event.key.toLowerCase() !== "k"
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
      <Sidebar collapsible="icon" className="group-data-[side=left]:border-r-0">
        {/* Brand row — rendered outside SidebarHeader to control height */}
        <BrandHeader />

        <SidebarHeader className="gap-1 px-2 pt-2 pb-1">
          {/* New Chat */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<button type="button" />}
                className="h-9 gap-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                onClick={() => setGroupChatDialogOpen(true)}
                tooltip="New chat"
              >
                <PlusIcon className="size-4 shrink-0" />
                <span className="group-data-[collapsible=icon]:hidden">
                  New Chat
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {/* Search */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<button type="button" />}
                className="h-9 gap-2 text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                onClick={() => setSearchOpen(true)}
                tooltip="Search chats"
              >
                <SearchIcon className="size-4 shrink-0" />
                <span className="group-data-[collapsible=icon]:hidden flex-1 text-left">
                  Search chats
                </span>
                <KbdGroup className="ml-auto gap-0 group-data-[collapsible=icon]:hidden">
                  <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="group-data-[collapsible=icon]:pt-0">
            <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
              Recents
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="group-data-[collapsible=icon]:gap-2">
                {chats.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      render={<button type="button" />}
                      isActive={pathname === `/chats/${chat.id}`}
                      className={cn(
                        "h-auto min-h-10 p-1.5 group-data-[collapsible=icon]:min-h-0! group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:p-0!",
                        chat.lastMessagePreview
                          ? "items-start"
                          : "items-center"
                      )}
                      onClick={() => handleChatSelect(chat.id)}
                      tooltip={chat.name}
                    >
                      {chat.kind === "group" ? (
                        <GroupChatAvatar
                          bots={chat.bots}
                          fallbackSeed={chat.id}
                          animated
                          alt={`${chat.name} avatar`}
                          className="size-8 shrink-0 rounded-lg group-data-[collapsible=icon]:size-8"
                        />
                      ) : (
                        <ChatAvatar
                          seed={chat.bot?.avatar ?? chat.id}
                          animated
                          alt={`${chat.name} avatar`}
                          className="size-8 shrink-0 rounded-lg group-data-[collapsible=icon]:size-8"
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 group-data-[collapsible=icon]:hidden">
                        <span className="w-full truncate text-xs font-medium">
                          {chat.name}
                        </span>
                        {chat.lastMessagePreview && (
                          <span className="w-full truncate text-[11px] text-sidebar-foreground/60">
                            {chat.lastMessagePreview}
                          </span>
                        )}
                      </span>
                      <time className="shrink-0 text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
                        {chat.lastMessageAtLabel}
                      </time>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="px-2 pb-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<button type="button" />}
                className="h-9 gap-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                onClick={() => setMembersOpen(true)}
                tooltip="Settings"
              >
                <SettingsIcon className="size-4 shrink-0" />
                <span className="group-data-[collapsible=icon]:hidden">
                  Settings
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      {/* Dialogs */}
      <BotDialog
        initialAvatarSeed={avatarSeed}
        open={botDialogOpen}
        onOpenChange={setBotDialogOpen}
        showTrigger={false}
      />
      <GroupChatDialog
        bots={bots}
        open={groupChatDialogOpen}
        onOpenChange={setGroupChatDialogOpen}
      />

      {/* Settings dialog — Members + Workspace entries */}
      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="max-w-xs gap-3 p-5">
          <DialogHeader>
            <DialogTitle className="text-sm">Settings</DialogTitle>
            <DialogDescription className="text-xs">
              Manage bots and workspace settings.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2 text-sm"
              onClick={() => {
                setMembersOpen(false)
                setBotDialogOpen(true)
              }}
            >
              <UsersIcon className="size-4 shrink-0" />
              Members &amp; Bots
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2 text-sm"
              onClick={() => {
                setMembersOpen(false)
                setWorkspaceSettingsOpen(true)
              }}
            >
              <SettingsIcon className="size-4 shrink-0" />
              Workspace directory
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search command palette */}
      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search chats"
        description="Search your chats"
        className="sm:max-w-lg"
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
                  {chat.kind === "group" ? (
                    <GroupChatAvatar
                      bots={chat.bots}
                      fallbackSeed={chat.id}
                      animated
                      alt={`${chat.name} avatar`}
                      className="size-8 rounded-lg"
                    />
                  ) : (
                    <ChatAvatar
                      seed={chat.bot?.avatar ?? chat.id}
                      animated
                      alt={`${chat.name} avatar`}
                      className="size-8 rounded-lg"
                    />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">{chat.name}</span>
                    {chat.lastMessagePreview && (
                      <span className="truncate text-xs text-muted-foreground">
                        {chat.lastMessagePreview}
                      </span>
                    )}
                  </span>
                  <CommandShortcut>{chat.lastMessageAtLabel}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={setWorkspaceSettingsOpen}
      />
    </>
  )
}
