"use client"

import { useRef, useState } from "react"
import { isToolUIPart, type FileUIPart, type ReasoningUIPart } from "ai"
import {
  ArrowRightLeftIcon,
  ArrowUpRightIcon,
  BrainIcon,
  BookMarkedIcon,
  BookOpenIcon,
  CircleAlertIcon,
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
import { ProjectToolSource } from "@/components/project-tool-source"
import {
  projectDecisionMediaType,
  projectRecordId,
  toolCallAnchor,
} from "@/lib/project-decisions"
import { ProjectMemoryButton } from "@/components/project-memory-dialog"
import { useParams } from "next/navigation"
import { useWorkspaceDocument } from "@/components/workspace-document-provider"
import { formatAttachmentSize } from "@/lib/chat-composer"
import { workspaceImageSource } from "@/lib/workspace-document"
import { workspaceOpenPolicy } from "@/lib/workspace-open-policy"
import { ImagePreview } from "@/components/image-preview"
import { FileTypeIcon } from "@/components/file-type-icon"
import { ChatMarkdown } from "@/components/chat-markdown"
import type { GroupActivity } from "@/lib/group-chat-activity"
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

function ToolStep({
  part,
  active,
  anchor,
}: {
  part: ChatToolPart
  active: boolean
  anchor?: string
}) {
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
  if (tool.memory) {
    const { decision, sourceMessageId, evidence } = tool.memory
    return (
      <div className="space-y-1.5">
        {line}
        <div className="space-y-1.5 pl-6 text-sm">
          <p className="wrap-anywhere">{decision}</p>
          <ProjectToolSource evidence={evidence} />
          <a
            className="text-xs underline underline-offset-2"
            href={
              "#" +
              encodeURIComponent(toolCallAnchor(sourceMessageId, evidence.toolCallId))
            }
          >
            View tool call
          </a>
        </div>
      </div>
    )
  }
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
      <TraceCollapsibleTrigger id={anchor} className="focus:bg-muted">
        {line}
      </TraceCollapsibleTrigger>
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

export function GroupToolActivity({
  approval,
  toolAnchor,
  summary,
  disabled,
  onRespond,
}: {
  approval?: ChatToolPart
  toolAnchor: string
  summary: GroupActivity
  disabled: boolean
  onRespond?: RespondToApproval
}) {
  const chatId = useParams<{ chatId: string }>()?.chatId
  const { kind, title, status, result, decisionId, sourceAnchor } = summary
  const Icon =
    status === "error"
      ? CircleAlertIcon
      : {
          skill: BookOpenIcon,
          handoff: ArrowRightLeftIcon,
          tool: WrenchIcon,
          decision: BookMarkedIcon,
        }[kind]
  return (
    <div
      id={toolAnchor}
      tabIndex={-1}
      data-group-activity={kind}
      className="min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      {approval ? (
        <ChatApproval
          part={approval}
          summary={title}
          disabled={disabled}
          onRespond={onRespond}
        />
      ) : (
        <>
          <TraceLine status={status}>
            <TraceIcon>
              <Icon />
            </TraceIcon>
            <TraceTitle className="wrap-anywhere whitespace-normal">
              {title}
            </TraceTitle>
          </TraceLine>
          {result && (
            <p className="pb-1 pl-6 text-sm wrap-anywhere">{result}</p>
          )}
          {decisionId && chatId && (
            <div className="flex flex-wrap items-center gap-x-3 pb-1 pl-6 text-xs">
              <ProjectMemoryButton
                chatId={chatId}
                recordId={decisionId}
                label="查看决定"
              />
              {sourceAnchor && (
                <a
                  className="underline underline-offset-2"
                  href={"#" + encodeURIComponent(sourceAnchor)}
                >
                  核对本次调用
                </a>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function ChatActivity({
  part,
  active,
  toolAnchor,
}: {
  part: ChatPart
  active: boolean
  toolAnchor?: string
}) {
  const chatId = useParams<{ chatId: string }>()?.chatId
  if (part.type === "reasoning")
    return <ReasoningStep part={part} active={active} />
  if (isToolUIPart(part))
    return <ToolStep part={part} active={active} anchor={toolAnchor} />
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
  if (
    part.type === "source-document" &&
    part.mediaType === projectDecisionMediaType &&
    chatId &&
    projectRecordId.safeParse(part.sourceId).success
  )
    return <ProjectMemoryButton chatId={chatId} recordId={part.sourceId} />
  if (part.type === "source-document")
    return (
      <TraceLine>
        <TraceIcon>
          <FileTypeIcon
            filename={part.filename || part.title}
            mediaType={part.mediaType}
          />
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
  summary,
}: {
  part: ChatToolPart
  disabled: boolean
  onRespond?: RespondToApproval
  summary?: string
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const submitting = useRef(false)
  if (part.state !== "approval-requested") return null
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
        <ItemTitle>
          {summary ?? getToolPresentation(part, false).title}
        </ItemTitle>
        {!summary && (
          <ItemDescription>
            {part.approval.requestReason ||
              "Review the input before allowing this tool to run."}
          </ItemDescription>
        )}
      </ItemContent>
      {!summary && (
        <div className="w-full">
          <ToolValue label="Input" value={part.input} />
        </div>
      )}
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

function SavedDocumentTrigger({
  relativePath,
  name,
}: {
  relativePath: string
  name: string
}) {
  const { open } = useWorkspaceDocument()
  const { chatId } = useParams<{ chatId: string }>()
  return (
    <AttachmentTrigger
      aria-label={`Open ${name}`}
      onClick={() => void open({ chatId, relativePath })}
    />
  )
}

export function ChatFile({
  part,
  savedPath,
  mentionedPath,
  referenceSize,
}: {
  part: FileUIPart
  savedPath?: unknown
  mentionedPath?: string
  referenceSize?: number
}) {
  const { chatId } = useParams<{ chatId: string }>()
  const relative = mentionedPath ?? (
    typeof savedPath === "string" && savedPath.startsWith("uploads/")
      ? savedPath
      : undefined)
  const kind = relative && workspaceOpenPolicy(relative).kind
  const diskImage =
    relative && kind === "internal-image"
      ? workspaceImageSource({ chatId, relativePath: relative })
      : undefined
  const imageUrl = diskImage?.url ?? safeChatImageUrl(part.url, part.mediaType)
  const url = safeChatUrl(part.url)
  const name = part.filename || (imageUrl ? "Generated image" : "Attached file")
  return (
    <Attachment
      state="done"
      size="xs"
      className="max-w-[min(100%,16rem)] min-w-0"
      title={name}
    >
      <AttachmentMedia variant="icon">
        <FileTypeIcon filename={part.filename || relative} mediaType={part.mediaType} />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
        <AttachmentDescription>
          {referenceSize === undefined
            ? part.mediaType
            : formatAttachmentSize(referenceSize)}
        </AttachmentDescription>
      </AttachmentContent>
      {imageUrl ? (
        <ImagePreview
          source={{
            url: imageUrl,
            name,
            workspace: diskImage?.workspace,
            fallbackUrl: diskImage && safeChatImageUrl(part.url, part.mediaType),
          }}
          trigger={<AttachmentTrigger aria-label={`Preview ${name}`} />}
        />
      ) : relative && (kind === "external" || kind === "internal-text") ? (
        <SavedDocumentTrigger relativePath={relative} name={name} />
      ) : (
        url && (
          <AttachmentTrigger
            render={<a href={url} target="_blank" rel="noreferrer" />}
            aria-label={`Open ${name} (opens in a new tab)`}
          />
        )
      )}
    </Attachment>
  )
}
