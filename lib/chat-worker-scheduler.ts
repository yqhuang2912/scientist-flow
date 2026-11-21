import { randomUUID } from "node:crypto"

type WorkerQueue<Job> = {
  claim: (lease: string, activeChats: string[]) => Promise<Job | undefined>
  execute: (job: Job, lease: string) => Promise<void>
  hasPending: (activeChats: string[]) => Promise<boolean>
}

const maxConcurrentChats = 2

export function createChatWorker<Job extends { chatId: string }>({
  claim,
  execute,
  hasPending,
}: WorkerQueue<Job>) {
  const active = new Set<string>()
  let draining = false
  let requested = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function wake() {
    clearTimeout(timer)
    requested = true
    if (draining || active.size >= maxConcurrentChats) return
    draining = true
    void drain()
  }

  async function run(job: Job, lease: string) {
    try {
      await execute(job, lease)
    } catch {
      // A failed settlement can leave a running row for lease recovery.
    } finally {
      active.delete(job.chatId)
      wake()
    }
  }

  async function drain() {
    let retry = false
    try {
      do {
        requested = false
        const lease = randomUUID()
        const job = await claim(lease, [...active])
        if (job) {
          active.add(job.chatId)
          void run(job, lease)
          requested = true
        } else {
          retry = await hasPending([...active])
        }
      } while (requested && active.size < maxConcurrentChats)
    } catch {
      retry = true
    } finally {
      draining = false
      if (retry && active.size < maxConcurrentChats) {
        timer = setTimeout(wake, 10_000)
        timer.unref()
      }
    }
  }

  return wake
}
