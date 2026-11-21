import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate as nextTurn } from "node:timers/promises"
import { createChatWorker } from "../lib/chat-worker-scheduler"

function gate() {
  let open!: () => void
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, wait }
}

test("a second chat can finish before a blocked chat; repeated wakes cannot preclaim a third turn", async () => {
  const slow = gate()
  const fast = gate()
  const firstClaim = gate()
  const queue = ["A"]
  const events: string[] = []
  const claims: string[][] = []
  const wake = createChatWorker({
    claim: async (_, activeChats) => {
      claims.push(activeChats)
      await firstClaim.wait
      const i = queue.findIndex((chat) => !activeChats.includes(chat))
      if (i !== -1) return { chatId: queue.splice(i, 1)[0] }
    },
    execute: async ({ chatId }) => {
      events.push(chatId + " started")
      if (chatId === "A") await slow.wait
      if (chatId === "B") await fast.wait
      events.push(chatId + " finished")
    },
    hasPending: async () => false,
  })
  wake()
  wake()
  assert.equal(claims.length, 1)
  firstClaim.open()
  await nextTurn()
  assert.deepEqual(events, ["A started"])

  queue.push("B", "C")
  wake()
  await nextTurn()
  const whileFull = claims.length
  for (let i = 0; i < 10; i++) wake()
  await nextTurn()
  assert.deepEqual(events, ["A started", "B started"])
  assert.deepEqual(claims.at(-1), ["A"])
  assert.equal(claims.length, whileFull)
  assert.deepEqual(queue, ["C"])

  fast.open()
  await nextTurn()
  assert.deepEqual(events.slice(2), ["B finished", "C started", "C finished"])
  slow.open()
  await nextTurn()
  assert.equal(events.at(-1), "A finished")
})

test("a rejected execution releases its slot and an already queued chat is claimed", async () => {
  const held = gate()
  const failure = gate()
  const queue = ["A", "B", "C"]
  const events: string[] = []
  const wake = createChatWorker({
    claim: async () => {
      const chatId = queue.shift()
      return chatId ? { chatId } : undefined
    },
    execute: async ({ chatId }) => {
      events.push(chatId)
      if (chatId === "A") await held.wait
      if (chatId === "B") {
        await failure.wait
        throw new Error("Execution failed")
      }
    },
    hasPending: async () => false,
  })
  wake()
  await nextTurn()
  assert.deepEqual(events, ["A", "B"])
  failure.open()
  await nextTurn()
  assert.deepEqual(events, ["A", "B", "C"])
  held.open()
  await nextTurn()
})
