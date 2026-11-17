import { AppSidebar } from "@/components/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { getBots, getUserChats } from "@/queries/bots"

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const [chats, bots] = await Promise.all([getUserChats(), getBots()])
  return (
    <SidebarProvider
      defaultOpen={true}
      className="h-svh overflow-hidden"
    >
      <AppSidebar chats={chats} bots={bots} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </SidebarProvider>
  )
}
