"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { PlusIcon } from "lucide-react"
import { TaskBotIdentity } from "./task-bot-identity"
import { compactItemStyles } from "./ui/compact-styles"
import { ChatAvatar } from "./chat-avatar"
import { FileTypeIcon } from "./file-type-icon"
import { Command, CommandGroup, CommandItem, CommandList } from "./ui/command"
import { InputGroupTextarea } from "./ui/input-group"
import { compactChatAvatarStyles } from "./ui/compact-styles"
import { mentionQuery, rebaseMentions, type Mention } from "@/lib/chat-mentions"
import { shouldSubmitChatMessage } from "@/lib/chat-composer"

type Bot = { id: string; name: string; avatar: string; job?: string }
type Choice = Pick<Mention, "kind" | "value" | "label">
type Files = { query: string; chatId: string; paths: string[]; notice?: string }
const createChoice = {
  kind: "create" as const,
  value: "new",
  label: "Create bot",
}
const keyOf = (c: Choice | typeof createChoice) => c.kind + ":" + c.value

export function ChatMentionInput({
  id,
  chatId,
  bots,
  value,
  mentions,
  change,
  inputRef,
  onBlur,
  error,
  canSend,
  onCreateBot,
  fieldLabel,
  maxLength,
}: {
  id: string
  chatId?: string
  bots: Bot[]
  value: string
  mentions: Mention[]
  change: (text: string, mentions: Mention[]) => void
  inputRef?: (node: HTMLTextAreaElement | null) => void
  onBlur?: () => void
  error?: boolean
  fieldLabel?: string
  maxLength?: number
  canSend?: boolean
  onCreateBot?: (insert: (bot: Bot) => void) => void
}) {
  const multiline = !!(onCreateBot || fieldLabel)
  const textarea = useRef<HTMLTextAreaElement | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [highlight, setHighlight] = useState("")
  const [files, setFiles] = useState<Files | null>(null)
  const match =
    caret === null || composing ? null : mentionQuery(value, caret, mentions)
  const token = match ? match.start + ":" + match.query : null
  const query = match && dismissed !== token ? match.query : null
  const open = query !== null

  useEffect(() => {
    if (query === null || !chatId) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/workspace/${encodeURIComponent(chatId)}/tree?mention=${encodeURIComponent(query)}`,
          { signal: controller.signal, cache: "no-store" }
        )
        const result = await response.json()
        if (!response.ok && result.code !== "NOT_INITIALISED") throw new Error()
        if (!controller.signal.aborted)
          setFiles({
            chatId,
            query,
            paths: result.paths ?? [],
            notice:
              result.code === "NOT_INITIALISED"
                ? "Workspace is not initialised."
                : result.truncated
                  ? "Partial results. Type a folder path to narrow your search."
                  : undefined,
          })
      } catch {
        if (!controller.signal.aborted)
          setFiles({
            chatId,
            query,
            paths: [],
            notice: "Workspace files are unavailable.",
          })
      }
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [chatId, query])

  const result =
    files?.chatId === chatId && files?.query === query ? files : null
  const botChoices = bots
    .filter((b) => b.name.toLowerCase().includes((query ?? "").toLowerCase()))
    .map((bot) => ({
      kind: "bot" as const,
      value: bot.id,
      label: bot.name,
      bot,
    }))
  const fileChoices = (result?.paths ?? []).map((p) => ({
    kind: "file" as const,
    value: p,
    label: p,
  }))
  const choices = [
    ...botChoices,
    ...fileChoices,
    ...(onCreateBot ? [createChoice] : []),
  ]
  const active = choices.find((c) => keyOf(c) === highlight) ?? choices[0]
  const activeKey = active ? keyOf(active) : ""
  const notice =
    result?.notice ??
    (chatId && !result
      ? "Finding files…"
      : !choices.length
        ? "No matches."
        : null)

  useLayoutEffect(() => {
    const input = textarea.current
    const list = menu.current?.querySelector('[role="listbox"]')
    const option = menu.current?.querySelector<HTMLElement>(
      `[data-value="${CSS.escape(activeKey)}"]`
    )
    if (open && list) input?.setAttribute("aria-controls", list.id)
    else input?.removeAttribute("aria-controls")
    if (open && option) {
      input?.setAttribute("aria-activedescendant", option.id)
      option.scrollIntoView({ block: "nearest" })
    } else input?.removeAttribute("aria-activedescendant")
  }, [open, activeKey])

  function choose(choice: Choice | typeof createChoice) {
    if (choice.kind === "create") {
      onCreateBot?.((bot) =>
        insert({ kind: "bot", value: bot.id, label: bot.name })
      )
    } else insert(choice)
  }
  function insert(choice: Choice) {
    if (!match || caret === null) return
    const label = "@" + choice.label
    const end = match.start + label.length
    const tail = value.slice(caret)
    const space = /^\s/u.test(tail) ? "" : " "
    const next = value.slice(0, match.start) + label + space + tail
    const nextCaret = end + (space.length || 1)
    const others = rebaseMentions(value, next, end + space.length, mentions)
    change(next, [
      ...others,
      {
        kind: choice.kind,
        value: choice.value,
        label: choice.label,
        start: match.start,
        end,
      },
    ])
    setCaret(nextCaret)
    setHighlight("")
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }
  return (
    <>
      {open && (
        <div
          ref={menu}
          className={
            multiline
              ? "order-last mt-1 overflow-hidden rounded-xl border bg-popover"
              : "absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden rounded-2xl border bg-popover shadow-lg sm:right-auto sm:w-96"
          }
          onMouseDown={(event) => event.preventDefault()}
        >
          <Command
            label="Mentions"
            shouldFilter={false}
            value={activeKey}
            onValueChange={setHighlight}
          >
            <CommandList
              label="Mention suggestions"
              className="max-h-[min(18rem,35dvh)]"
            >
              {!!botChoices.length && (
                <CommandGroup heading="Bots">
                  {botChoices.map((c) => (
                    <CommandItem
                      key={c.value}
                      value={keyOf(c)}
                      onSelect={() => choose(c)}
                      className={onCreateBot ? compactItemStyles : undefined}
                    >
                      {onCreateBot ? (
                        <TaskBotIdentity bot={c.bot} />
                      ) : (
                        <>
                          <ChatAvatar
                            seed={c.bot.avatar}
                            alt=""
                            className={compactChatAvatarStyles}
                          />
                          <span className="truncate">{c.label}</span>
                          <span className="truncate type-meta text-muted-foreground">
                            {c.bot.job}
                          </span>
                        </>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!!fileChoices.length && (
                <CommandGroup heading="Workspace files">
                  {fileChoices.map((c) => (
                    <CommandItem
                      key={c.value}
                      value={keyOf(c)}
                      onSelect={() => choose(c)}
                      title={c.label}
                    >
                      <FileTypeIcon filename={c.label} />
                      <span className="truncate">
                        {c.label.split("/").at(-1)}
                      </span>
                      {c.label.includes("/") && (
                        <span className="ml-auto truncate type-meta text-muted-foreground">
                          {c.label.slice(0, c.label.lastIndexOf("/"))}/
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {onCreateBot && (
                <CommandGroup>
                  <CommandItem
                    value={keyOf(createChoice)}
                    className={compactItemStyles}
                    onSelect={() => choose(createChoice)}
                  >
                    <PlusIcon /> Create bot
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
            {notice && (
              <div
                role="status"
                className="px-3 py-2 type-meta text-muted-foreground"
              >
                {notice}
              </div>
            )}
          </Command>
        </div>
      )}
      <InputGroupTextarea
        id={id}
        name="text"
        aria-label={fieldLabel}
        autoFocus={!!fieldLabel}
        maxLength={maxLength}
        size="composer"
        value={value}
        ref={(node) => {
          textarea.current = node
          inputRef?.(node)
        }}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-invalid={error}
        aria-describedby={error ? id + "-error" : undefined}
        placeholder={
          fieldLabel
            ? "输入 @ 选择群内 Bot"
            : onCreateBot
              ? "Describe the task. Type @ to select or create a bot."
              : "Message your bot… Type @ to mention"
        }
        className={
          multiline
            ? "min-h-28 resize-y rounded-xl border border-muted-foreground/50 bg-background px-3 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            : "max-h-48 min-h-13"
        }
        onBlur={() => {
          setCaret(null)
          onBlur?.()
        }}
        onFocus={(e) => setCaret(e.currentTarget.selectionStart)}
        onSelect={(e) =>
          setCaret(
            e.currentTarget.selectionStart === e.currentTarget.selectionEnd
              ? e.currentTarget.selectionStart
              : null
          )
        }
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onChange={(e) => {
          const { value: next, selectionStart } = e.currentTarget
          change(next, rebaseMentions(value, next, selectionStart, mentions))
          setCaret(selectionStart)
          setDismissed(null)
          setHighlight("")
        }}
        onKeyDown={(e) => {
          if (
            composing ||
            e.nativeEvent.isComposing ||
            e.nativeEvent.keyCode === 229
          )
            return
          if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault()
            if (choices.length) {
              const index = choices.findIndex((c) => keyOf(c) === activeKey)
              setHighlight(
                keyOf(
                  choices[
                    (index +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      choices.length) %
                      choices.length
                  ]
                )
              )
            }
            return
          }
          if (open && e.key === "Escape") {
            e.preventDefault()
            setDismissed(token)
            return
          }
          if (
            !shouldSubmitChatMessage({
              key: e.key,
              shiftKey: e.shiftKey,
              isComposing: false,
            })
          )
            return
          if (multiline && !open) return
          e.preventDefault()
          if (open) {
            if (active) choose(active)
            return
          }
          if (canSend) e.currentTarget.form?.requestSubmit()
        }}
      />
    </>
  )
}
