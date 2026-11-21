"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import type { TaskTemplateSummary } from "@/db/schema"
import type { SettingsLeaveGuard } from "@/components/settings-form-guard"
import { useChatMarkers } from "./use-chat-markers"
import type { ChatMarker } from "@/lib/chat-activity-status"
import { LoaderCircleIcon, PauseIcon, PlusIcon, SearchIcon, SettingsIcon, DiamondIcon } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"

import { BotName } from "@/components/bot-name"
import { ChatAvatar } from "@/components/chat-avatar"
import { compactChatAvatarStyles } from "@/components/ui/compact-styles"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { TaskDialog } from "@/components/task-dialog"
import { SettingsDialog } from "@/components/settings-dialog"
import type { BotSummary, SidebarChat } from "@/queries/bots"
import { cn } from "@/lib/utils"
import {
  CHAT_ACCEPTED_EVENT,
  chatTimeLabels,
  mergeChatAcceptance,
  type ChatAcceptedDetail,
} from "@/lib/chat-recency"
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

function ActivityMark({ state }: { state: ChatMarker }) {
  const label = state === "running" ? "Running" : state === "waiting" ? "Waiting for your input" : "Unread reply"
  return (
    <span role="img" aria-label={label} title={label}
      className="flex size-4 shrink-0 items-center justify-center group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-0 group-data-[collapsible=icon]:bottom-0 group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:bg-sidebar">
      {state === "running" ? <LoaderCircleIcon aria-hidden className="size-3 motion-safe:animate-spin text-muted-foreground" />
        : state === "waiting" ? <PauseIcon aria-hidden className="size-3 text-amber-600 dark:text-amber-400" />
          : <span aria-hidden className="size-2 rounded-full bg-blue-500" />}
    </span>
  )
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

const WorkflowWindow = dynamic(() =>
  import("./workflow-window").then((module) => module.WorkflowWindow)
)

export function AppSidebar({
  chats: initialChats,
  bots,
}: {
  chats: SidebarChat[]
  bots: BotSummary[]
}) {
  const pathname = usePathname()
  const markers = useChatMarkers(pathname)
  const router = useRouter()
  const { setOpenMobile } = useSidebar()
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [workflow, setWorkflow] = useState<{
    template: TaskTemplateSummary
    activation: number
  } | null>(null)
  const workflowGuard = useRef<SettingsLeaveGuard>(null)
  function updateOpenTemplate(id: string, template: TaskTemplateSummary | null) {
    setWorkflow((current) => {
      if (current?.template.id !== id) return current
      return template ? { ...current, template } : null
    })
  }
  function leaveWorkflow(leave: () => void) {
    if (workflowGuard.current) workflowGuard.current(leave)
    else leave()
  }
  function openWorkflow(template: TaskTemplateSummary) {
    setSettingsTab(null)
    const activate = () =>
      setWorkflow((previous) => ({
        template,
        activation: (previous?.activation ?? 0) + 1,
      }))
    if (workflow && workflow.template.id !== template.id) leaveWorkflow(activate)
    else activate()
  }
  const [accepted, setAccepted] = useState<Record<string, ChatAcceptedDetail>>(
    {}
  )
  useEffect(() => {
    function onAccepted(event: Event) {
      const update = (event as CustomEvent<ChatAcceptedDetail>).detail
      setAccepted((previous) => mergeChatAcceptance(previous, update))
    }
    window.addEventListener(CHAT_ACCEPTED_EVENT, onAccepted)
    return () => window.removeEventListener(CHAT_ACCEPTED_EVENT, onAccepted)
  }, [])
  const chats = useMemo(
    () =>
      initialChats
        .map((chat) => {
          const update = accepted[chat.id]
          if (!update || update.acceptedAt <= chat.lastMessageAt) return chat
          return {
            ...chat,
            lastMessageAt: update.acceptedAt,
            lastMessagePreview: update.lastMessagePreview,
            ...chatTimeLabels(new Date(update.acceptedAt)),
          }
        })
        .sort(
          (a, b) =>
            b.lastMessageAt.localeCompare(a.lastMessageAt) ||
            a.id.localeCompare(b.id)
        ),
    [initialChats, accepted]
  )
  const [settingsTab, setSettingsTab] = useState<
    "general" | "skills" | "tools" | "connections" | null
  >(null)
  useEffect(() => {
    const manageGeneral = () => setSettingsTab("general")
    window.addEventListener("scientistflow:manage-general", manageGeneral)
    const manageSkills = () => setSettingsTab("skills")
    window.addEventListener("scientistflow:manage-skills", manageSkills)
    const manageTools = () => setSettingsTab("tools")
    const manageConnections = () => setSettingsTab("connections")
    window.addEventListener("scientistflow:manage-connections", manageConnections)
    window.addEventListener("scientistflow:manage-tools", manageTools)
    return () => {
      window.removeEventListener("scientistflow:manage-connections", manageConnections)
      window.removeEventListener("scientistflow:manage-general", manageGeneral)
      window.removeEventListener("scientistflow:manage-skills", manageSkills)
      window.removeEventListener("scientistflow:manage-tools", manageTools)
    }
  }, [])
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
                        "relative text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0!",
                        "group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground"
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
                      <span className="min-w-0 flex-1 truncate text-[13px] leading-5 font-medium group-data-[collapsible=icon]:hidden">
                        {chat.name}
                      </span>
                      {markers[chat.id] ? <ActivityMark state={markers[chat.id]} /> : <time
                        dateTime={chat.lastMessageAt}
                        title={chat.lastMessageAtTitle}
                        aria-label={chat.lastMessageAtTitle}
                        className="shrink-0 text-[11px] font-normal whitespace-nowrap text-muted-foreground tabular-nums group-data-[collapsible=icon]:hidden"
                      >
                        {chat.lastMessageAtLabel}
                      </time>}
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
        onOpenWorkflow={openWorkflow}
        onWorkspaceSaved={() =>
          window.dispatchEvent(new Event("scientistflow:workspace-root-changed"))
        }
      />

      {workflow && (
        <WorkflowWindow
          key={workflow.template.id}
          template={workflow.template}
          activation={workflow.activation}
          guard={workflowGuard}
          onTemplateChange={updateOpenTemplate}
          onClose={() => leaveWorkflow(() => setWorkflow(null))}
        />
      )}

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
