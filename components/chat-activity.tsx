"use client"

import { useRef, useState } from "react"
import { isToolUIPart, type FileUIPart, type ReasoningUIPart } from "ai"
import {
  ArrowRightLeftIcon,
  ArrowUpRightIcon,
  BrainIcon,
  BookOpenIcon,
  CircleAlertIcon,
  FileTextIcon,
  GlobeIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from "lucide-react"
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { ChatMarkdown } from "@/components/chat-markdown"
import {
  formatToolValue,
  getToolPresentation,
  getSkillReadPresentation,
  safeChatImageUrl,
  safeChatUrl,
  type ChatPart,
  type ChatToolPart,
} from "@/lib/chat-presentation"

export type RespondToApproval = (response: {
  id: string
  approved: boolean
}) => void | PromiseLike<void>

function ToolValue({
  label,
  value,
  error = false,
}: {
  label: string
  value: unknown
  error?: boolean
}) {
  const text = formatToolValue(value)
  const limit = 32_768
  return (
    <CodeBlock size="sm" variant={error ? "destructive" : "default"}>
      <CodeBlockHeader>
        <CodeBlockTitle>{label}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={text} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-64">
        {text.slice(0, limit)}
      </CodeBlockContent>
      {text.length > limit && (
        <p className="px-2.5 pb-2 text-xs text-muted-foreground">
          Display truncated at 32,768 characters.
        </p>
      )}
    </CodeBlock>
  )
}

function ReasoningStep({
  part,
  active,
}: {
  part: ReasoningUIPart
  active: boolean
}) {
  const [open, setOpen] = useState<boolean>()
  const running = active && part.state === "streaming"
  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        <BrainIcon />
      </TraceIcon>
      <TraceTitle>
        {running ? "Thinking" : part.state === "done" ? "Thought" : "Reasoning"}
      </TraceTitle>
    </TraceLine>
  )
  if (!part.text) return line
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="mt-1 max-h-56 overflow-y-auto">
        <ChatMarkdown variant="reasoning" isAnimating={running}>
          {part.text}
        </ChatMarkdown>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function ToolStep({ part, active }: { part: ChatToolPart; active: boolean }) {
  const [open, setOpen] = useState<boolean>()
  const tool = getToolPresentation(part, active)
  const skill = getSkillReadPresentation(part, active)
  if (skill) {
    const line = (
      <TraceLine status={skill.status}>
        <TraceIcon>
          <BookOpenIcon />
        </TraceIcon>
        <TraceTitle>{skill.title}</TraceTitle>
      </TraceLine>
    )
    return skill.detail ? (
      <TraceCollapsible
        open={open ?? skill.status === "error"}
        onOpenChange={setOpen}
      >
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>{skill.detail}</TraceCollapsibleContent>
      </TraceCollapsible>
    ) : (
      line
    )
  }
  const Icon =
    tool.status === "error"
      ? CircleAlertIcon
      : tool.name === "handoff"
        ? ArrowRightLeftIcon
        : WrenchIcon
  const line = (
    <TraceLine status={tool.status}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle title={tool.title}>{tool.title}</TraceTitle>
    </TraceLine>
  )
  if (
    tool.output === undefined &&
    !tool.error &&
    !tool.reason &&
    !tool.deniedReason
  )
    return line
  return (
    <TraceCollapsible
      open={open ?? tool.status === "error"}
      onOpenChange={setOpen}
    >
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">
        {tool.reason && <p>{tool.reason}</p>}
        {tool.deniedReason && <p>{tool.deniedReason}</p>}
        {tool.input !== undefined && (
          <ToolValue label="Input" value={tool.input} />
        )}
        {tool.output !== undefined && (
          <ToolValue label="Output" value={tool.output} />
        )}
        {tool.error && <ToolValue label="Error" value={tool.error} error />}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

export function ChatActivity({
  part,
  active,
}: {
  part: ChatPart
  active: boolean
}) {
  if (part.type === "reasoning")
    return <ReasoningStep part={part} active={active} />
  if (isToolUIPart(part)) return <ToolStep part={part} active={active} />
  if (part.type === "source-url") {
    const url = safeChatUrl(part.url)
    const line = (
      <TraceLine>
        <TraceIcon>
          <GlobeIcon />
        </TraceIcon>
        <TraceTitle title={part.title || part.url}>
          {part.title || part.url}
          {url && <span className="sr-only"> (opens in a new tab)</span>}
        </TraceTitle>
        {url && (
          <TraceIcon>
            <ArrowUpRightIcon />
          </TraceIcon>
        )}
      </TraceLine>
    )
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {line}
      </a>
    ) : (
      line
    )
  }
  if (part.type === "source-document")
    return (
      <TraceLine>
        <TraceIcon>
          <FileTextIcon />
        </TraceIcon>
        <TraceTitle title={part.filename || part.title}>
          {part.title}
        </TraceTitle>
      </TraceLine>
    )
  return null
}

export function ChatApproval({
  part,
  disabled,
  onRespond,
}: {
  part: ChatToolPart
  disabled: boolean
  onRespond?: RespondToApproval
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const submitting = useRef(false)
  if (part.state !== "approval-requested") return null
  const tool = getToolPresentation(part, false)
  const input = formatToolValue(part.input)
  const tooLarge = input.length > 32_768
  async function respond(approved: boolean) {
    if (!onRespond || submitting.current || part.state !== "approval-requested")
      return
    submitting.current = true
    setPending(true)
    setError(undefined)
    try {
      await onRespond({ id: part.approval.id, approved })
    } catch {
      setError("Could not send your decision. Please try again.")
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  return (
    <Item variant="outline" className="p-3">
      <ItemMedia variant="icon">
        <ShieldCheckIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{tool.title}</ItemTitle>
        <ItemDescription>
          {part.approval.requestReason ||
            "Review the input before allowing this tool to run."}
        </ItemDescription>
      </ItemContent>
      <div className="w-full">
        <ToolValue label="Input" value={part.input} />
      </div>
      {tooLarge && (
        <ItemDescription>
          Input is too large to review here. Approval is unavailable.
        </ItemDescription>
      )}
      {!onRespond && (
        <ItemDescription>This request is no longer active.</ItemDescription>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {onRespond && (
        <ItemActions className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || pending}
            onClick={() => void respond(false)}
          >
            Deny
          </Button>
          <Button
            size="sm"
            disabled={disabled || pending || tooLarge}
            onClick={() => void respond(true)}
          >
            {pending ? "Sending…" : "Approve"}
          </Button>
        </ItemActions>
      )}
    </Item>
  )
}

export function ChatFile({ part }: { part: FileUIPart }) {
  const imageUrl = safeChatImageUrl(part.url, part.mediaType)
  const url = safeChatUrl(part.url)
  const name = part.filename || (imageUrl ? "Generated image" : "Attached file")
  if (imageUrl)
    return (
      <figure className="flex max-w-full flex-col gap-2">
        {/* Model-produced images have arbitrary hosts; do not proxy them through Next. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-96 max-w-full rounded-xl object-contain"
        />
        {part.filename && (
          <figcaption className="text-xs text-muted-foreground">
            {part.filename}
          </figcaption>
        )}
      </figure>
    )
  return (
    <Attachment state="done" size="sm">
      <AttachmentMedia variant="icon">
        <FileTextIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
        <AttachmentDescription>{part.mediaType}</AttachmentDescription>
      </AttachmentContent>
      {url && (
        <AttachmentTrigger
          render={<a href={url} target="_blank" rel="noreferrer" />}
          aria-label={`Open ${name} (opens in a new tab)`}
        />
      )}
    </Attachment>
  )
}
