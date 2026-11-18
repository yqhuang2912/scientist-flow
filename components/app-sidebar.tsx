"use client"

import { useEffect, useState } from "react"
import { nanoid } from "nanoid"
import { PlusIcon, SearchIcon, SettingsIcon, DiamondIcon } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"

import { BotDialog } from "@/components/bot-dialog"
import { BotName } from "@/components/bot-name"
import { ChatAvatar } from "@/components/chat-avatar"
import { compactChatAvatarStyles } from "@/components/ui/compact-styles"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { TaskDialog } from "@/components/task-dialog"
import { SettingsDialog } from "@/components/settings-dialog"
import type { BotSummary, SidebarChat } from "@/queries/bots"
import { cn } from "@/lib/utils"
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function isMac() {
  if (typeof navigator === "undefined") return false
  return /mac/i.test(navigator.platform)
}

function BrandHeader() {
  const { state, isMobile } = useSidebar()
  const collapsed = !isMobile && state === "collapsed"

  return (
    <div
      className={cn(
        "dashboard-header px-2.5",
        collapsed ? "justify-center" : "justify-between"
      )}
    >
      {!collapsed && (
        <div className="flex min-w-0 items-center gap-1.5">
          <DiamondIcon
            className="size-4 shrink-0 text-foreground"
            strokeWidth={2}
          />
          <span className="truncate text-sm font-semibold tracking-tight">
            ScientistFlow
          </span>
        </div>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="shrink-0"
            />
          }
        />
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
  const { setOpenMobile } = useSidebar()
  const [botDialogOpen, setBotDialogOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<"general" | "skills" | null>(null)
  useEffect(() => {
    const manageSkills = () => setSettingsTab("skills")
    window.addEventListener("scientistflow:manage-skills", manageSkills)
    return () =>
      window.removeEventListener("scientistflow:manage-skills", manageSkills)
  }, [])
  const [avatarSeed] = useState(() => nanoid())
  const [mac] = useState(() => isMac())

  function handleChatSelect(chatId: string) {
    setSearchOpen(false)
    setOpenMobile(false)
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

        <SidebarHeader className="gap-0.5 px-2 pb-1">
          {/* New Chat */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<button type="button" />}
                className="group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
                onClick={() => setTaskDialogOpen(true)}
                tooltip="New task"
              >
                <PlusIcon data-icon="inline-start" />
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  New task
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {/* Search */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<button type="button" />}
                className="text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
                onClick={() => setSearchOpen(true)}
                tooltip="Search"
              >
                <SearchIcon data-icon="inline-start" />
                <span className="flex-1 truncate text-left group-data-[collapsible=icon]:hidden">
                  Search
                </span>
                <Kbd
                  variant="plain"
                  className="ml-auto shrink-0 group-data-[collapsible=icon]:hidden"
                >
                  {mac ? "⌘ K" : "Ctrl K"}
                </Kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="gap-0 px-2 pt-1 group-data-[collapsible=icon]:pt-0">
            <SidebarGroupLabel className="h-7.5 gap-1 rounded-xl px-1.5 text-[11px] font-medium text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
              Recents
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {chats.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      render={<button type="button" />}
                      isActive={pathname === `/chats/${chat.id}`}
                      className={cn(
                        "h-auto min-h-7.5 text-sidebar-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0!",
                        "group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground",
                        chat.lastMessagePreview
                          ? "items-start"
                          : "min-h-7.5 items-center"
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
                          className={compactChatAvatarStyles}
                        />
                      ) : (
                        <ChatAvatar
                          seed={chat.bot?.avatar ?? chat.id}
                          animated
                          alt={`${chat.name} avatar`}
                          className={compactChatAvatarStyles}
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0 group-data-[collapsible=icon]:hidden">
                        <span className="w-full truncate text-[13px] leading-5 font-medium">
                          {chat.name}
                        </span>
                        {chat.lastMessagePreview && (
                          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                            <span className="min-w-0 truncate">
                              {chat.lastMessagePreview}
                            </span>
                          </span>
                        )}
                      </span>
                      <time
                        dateTime={chat.lastMessageAt}
                        title={chat.lastMessageAtTitle}
                        aria-label={chat.lastMessageAtTitle}
                        className="shrink-0 text-[11px] font-normal whitespace-nowrap text-muted-foreground tabular-nums group-data-[collapsible=icon]:hidden"
                      >
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
                className="text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
                onClick={() => setSettingsTab("general")}
                tooltip="Settings"
              >
                <SettingsIcon data-icon="inline-start" />
                <span className="truncate group-data-[collapsible=icon]:hidden">
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
      <TaskDialog
        key={taskDialogOpen ? "new-task-open" : "new-task-closed"}
        bots={bots}
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
      />

      {/* Settings — one dialog, panes switch in place */}
      <SettingsDialog
        key={settingsTab ?? "general"}
        initialTab={settingsTab ?? "general"}
        bots={bots}
        open={settingsTab !== null}
        onOpenChange={(open) => setSettingsTab(open ? "general" : null)}
        onManageBots={() => {
          setSettingsTab(null)
          setBotDialogOpen(true)
        }}
      />

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
                  keywords={
                    chat.kind === "direct" && chat.bot ? [chat.bot.job] : []
                  }
                  onSelect={() => handleChatSelect(chat.id)}
                >
                  {chat.kind === "group" ? (
                    <GroupChatAvatar
                      bots={chat.bots}
                      fallbackSeed={chat.id}
                      animated
                      alt={`${chat.name} avatar`}
                      className={compactChatAvatarStyles}
                    />
                  ) : (
                    <ChatAvatar
                      seed={chat.bot?.avatar ?? chat.id}
                      animated
                      alt={`${chat.name} avatar`}
                      className={compactChatAvatarStyles}
                    />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <BotName
                      name={chat.name}
                      job={chat.kind === "direct" ? chat.bot?.job : null}
                    />
                    {chat.lastMessagePreview && (
                      <span className="truncate text-xs text-muted-foreground">
                        {chat.lastMessagePreview}
                      </span>
                    )}
                  </span>
                  <CommandShortcut className="shrink-0 whitespace-nowrap">
                    <time
                      dateTime={chat.lastMessageAt}
                      title={chat.lastMessageAtTitle}
                      aria-label={chat.lastMessageAtTitle}
                    >
                      {chat.lastMessageAtLabel}
                    </time>
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
