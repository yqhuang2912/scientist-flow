import { nanoid } from "nanoid"

import { DashboardStart } from "@/components/dashboard-start"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { getBots } from "@/queries/bots"

export const dynamic = "force-dynamic"

export default async function Page() {
  const avatarSeed = nanoid()
  const bots = await getBots()

  return (
    <main className="relative flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <SidebarTrigger
        aria-label="Open sidebar"
        className="absolute top-2 left-3 md:hidden"
      />
      <DashboardStart bots={bots} avatarSeed={avatarSeed} />
    </main>
  )
}
