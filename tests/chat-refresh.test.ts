import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { setImmediate as flush } from "node:timers/promises"
import type { ChatSnapshot, ChatTurnProgress } from "../lib/chat-job"
import { watchChatRefresh } from "../lib/chat-refresh"

const url = "/api/chats/group/messages"
const initial: ChatSnapshot = {
  activeId: null,
  error: "The bot could not complete its turn.",
  messages: [
    {
      id: "question",
      role: "user",
      parts: [{ type: "text", text: "Measure it" }],
    },
    {
      id: "reply",
      role: "assistant",
      parts: [
        {
          type: "tool-measure",
          toolCallId: "call-1",
          state: "output-available",
          input: {},
          output: { value: 12, unit: "ms" },
        },
      ],
    },
  ],
}

function fixture(
  t: TestContext,
  respond: () => Response | Promise<Response>,
  activeId: string | null = null
) {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const focusTarget = new EventTarget()
  const requests: string[] = []
  const state = {
    snapshot: initial,
    notice: null as string | null,
    canRead: true,
    progress: [] as ChatTurnProgress[],
  }
  t.mock.method(
    globalThis,
    "fetch",
    async (target: string, init: RequestInit) => {
      requests.push((init.method ?? "GET") + " " + target)
      return respond()
    }
  )
  const stop = watchChatRefresh({
    focusTarget,
    url,
    activeId,
    retryIdle: true,
    canRead: () => state.canRead,
    onSnapshot: (snapshot) => {
      state.snapshot = snapshot
    },
    onProgress: (turn) => state.progress.push(turn),
    onNetworkError: (notice) => {
      state.notice = notice
    },
  })
  t.after(stop)
  return {
    requests,
    state,
    stop,
    focus: () => focusTarget.dispatchEvent(new Event("focus")),
    tick: async (ms: number) => {
      t.mock.timers.tick(ms)
      await flush()
    },
  }
}

test("one focus recovers an idle group after two 503s without any further interaction", async (t) => {
  const responses = [503, 503, 200]
  const { state, focus, tick, requests } = fixture(t, () =>
    Response.json(initial, { status: responses.shift()! })
  )
  focus()
  await flush()
  assert.match(state.notice ?? "", /Reconnecting/)
  assert.equal(state.snapshot, initial)
  await tick(1000)
  assert.equal(requests.length, 2)
  assert.equal(state.snapshot, initial)
  await tick(2000)
  assert.deepEqual(requests, Array(3).fill("GET " + url))
  assert.equal(state.notice, null)
  assert.deepEqual(state.snapshot, initial)
  await tick(60_000)
  assert.equal(requests.length, 3)
})

test("idle retries back off to 30 seconds and start at one second again after recovery", async (t) => {
  let offline = true
  const { state, focus, tick, requests } = fixture(t, () => {
    if (offline) throw new TypeError("Network unavailable")
    return Response.json(initial)
  })
  focus()
  await flush()
  for (const interval of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
    const before = requests.length
    await tick(interval - 1)
    assert.equal(requests.length, before)
    await tick(1)
    assert.equal(requests.length, before + 1)
  }
  offline = false
  await tick(30_000)
  assert.equal(state.notice, null)
  offline = true
  focus()
  await flush()
  const before = requests.length
  await tick(1000)
  assert.equal(requests.length, before + 1)
})

for (const status of [403, 404]) {
  test(`HTTP ${status} ends automatic retries and preserves the bot's error`, async (t) => {
    const statuses = [503, status]
    const { state, focus, tick, requests } = fixture(
      t,
      () => new Response(null, { status: statuses.shift() })
    )
    focus()
    await flush()
    await tick(1000)
    assert.match(state.notice ?? "", new RegExp(String(status)))
    assert.doesNotMatch(state.notice ?? "", /Reconnecting/)
    assert.equal(state.snapshot, initial)
    await tick(60_000)
    assert.equal(requests.length, 2)
  })
}

for (const reason of ["unmount", "submit"] as const) {
  test(`focus and retry share one in-flight GET; ${reason} invalidates its late response`, async (t) => {
    const held = Promise.withResolvers<Response>()
    let first = true
    const { state, focus, tick, requests, stop } = fixture(t, () => {
      if (!first) return held.promise
      first = false
      return new Response(null, { status: 503 })
    })
    focus()
    await flush()
    focus()
    focus()
    await tick(1000)
    assert.deepEqual(requests, Array(2).fill("GET " + url))
    if (reason === "unmount") stop()
    else state.canRead = false
    const notice = state.notice
    held.resolve(
      Response.json({ messages: [], activeId: null, error: "stale" })
    )
    await flush()
    assert.equal(state.snapshot, initial)
    assert.equal(state.notice, notice)
    await tick(60_000)
    assert.equal(requests.length, 2)
  })
}

test("an active turn continues polling only its own progress until it settles", async (t) => {
  const progress: ChatTurnProgress = {
    turnId: "running",
    state: "running",
    replies: [],
    error: null,
  }
  const responses = [
    new Response(null, { status: 503 }),
    Response.json(progress),
    Response.json({ ...progress, state: "failed", error: "Bot failed" }),
  ]
  const { state, tick, requests } = fixture(
    t,
    () => responses.shift()!,
    progress.turnId
  )
  await flush()
  await tick(1000)
  await tick(1000)
  await tick(60_000)
  assert.deepEqual(requests, Array(3).fill("GET " + url + "?id=running"))
  assert.equal(state.notice, null)
  assert.equal(state.progress.at(-1)?.error, "Bot failed")
})
