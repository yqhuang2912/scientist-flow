"use client"

// Isolated visual fixture: no model, credentials, database or task execution.
// Mount temporarily from a development route when changing chat presentation.
import { useMemo, useState } from "react"
import { useTheme } from "next-themes"
import { useChat } from "@ai-sdk/react"
import {
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  simulateReadableStream,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai"
import { ChatTranscript } from "@/components/chat-transcript"
import { ChatComposer } from "@/components/chat-composer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const bots = [
  { id: "coll", name: "Coll", job: "Writing editor", avatar: "Coll" },
  { id: "paul", name: "Paul", job: "Research assistant", avatar: "Paul" },
]
const messageExample: UIMessage[] = [
  {
    id: "example-user",
    role: "user",
    metadata: { botId: "paul" },
    parts: [
      {
        type: "text",
        text: "How should I compare two experimental methods? Please explain how to keep the **input data** consistent and report accuracy and execution time.\n\n第二段也应该从消息左侧开始，不应保留 @Paul 的缩进。",
      },
    ],
  },
  {
    id: "example-assistant",
    role: "assistant",
    metadata: { botId: "paul" },
    parts: [
      {
        type: "text",
        state: "done",
        text: "Use the **same input data** and record both accuracy and execution time. Keep the comparison reproducible.\n\n```python\nfor method in methods:\n    result = evaluate(method, dataset)\n    results.append(result)\n```\n\nReport the mean and variability across repeated runs, then describe where each method works best.",
      },
    ],
  },
]
const diagram =
  "```mermaid\nflowchart LR\n A[Question] --> B[Sources]\n B --> C[Review]\n C --> D[Answer]\n```"
const overview: UIMessage[] = [
  {
    id: "user-overview",
    role: "user",
    metadata: { botId: "paul" },
    parts: [
      { type: "text", text: "Outline a reproducible literature review." },
    ],
  },
  {
    id: "assistant-overview",
    role: "assistant",
    metadata: { botId: "paul" },
    parts: [
      {
        type: "reasoning",
        state: "done",
        text: "Fixture reasoning summary: check the question, identify relevant sources, and distinguish evidence from conclusions.",
      },
      {
        type: "tool-searchPapers",
        toolCallId: "search-1",
        state: "output-available",
        input: { query: "reproducible literature review" },
        output: {
          papers: 3,
          query: "reproducible literature review",
          complete: true,
        },
      },
      {
        type: "source-url",
        sourceId: "source-1",
        title: "AI Elements documentation",
        url: "https://ui.shadcn.com/docs/ai-elements",
      },
      {
        type: "text",
        state: "done",
        text:
          "Start with a **focused question**, record your search, and keep the inclusion criteria explicit.\n\n1. Define the scope.\n2. Compare the sources.\n3. Record the evidence.\n\n" +
          diagram +
          "\n\nThe evidence score is $$s = \\frac{a}{b}$$.\n\n```python\ndef score(a, b):\n    return a / b\n```",
      },
    ],
  },
]

function makeTransport(): ChatTransport<UIMessage> {
  return {
    reconnectToStream: async () => null,
    async sendMessages({ messages, abortSignal }) {
      const last = messages.at(-1)
      const approvedPart = last?.parts.find(
        (p) => isToolUIPart(p) && p.state === "approval-responded"
      )
      const approved =
        approvedPart &&
        isToolUIPart(approvedPart) &&
        approvedPart.state === "approval-responded"
          ? approvedPart.approval.approved
          : false
      const request =
        last?.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("") ?? ""
      const messageId = approvedPart ? last!.id : `fixture-${messages.length}`
      const chunks: UIMessageChunk[] = [
        { type: "start", messageId, messageMetadata: { botId: "paul" } },
        { type: "start-step" },
      ]
      if (approvedPart && isToolUIPart(approvedPart)) {
        chunks.push(
          approved
            ? {
                type: "tool-output-available",
                toolCallId: approvedPart.toolCallId,
                output: "Fixture action completed. No real file was changed.",
              }
            : {
                type: "tool-output-denied",
                toolCallId: approvedPart.toolCallId,
              }
        )
        chunks.push(
          { type: "text-start", id: "reply" },
          {
            type: "text-delta",
            id: "reply",
            delta: approved
              ? "Approved and continued exactly once."
              : "Denied. The action did not run.",
          },
          { type: "text-end", id: "reply" }
        )
      } else if (request === "Approval") {
        chunks.push(
          {
            type: "tool-input-available",
            toolCallId: "approve-tool",
            toolName: "saveNotes",
            input: { path: "docs/review.md", content: "Fixture notes" },
          },
          {
            type: "tool-approval-request",
            approvalId: "fixture-approval",
            toolCallId: "approve-tool",
          }
        )
      } else if (request === "Failure") {
        chunks.push(
          {
            type: "tool-input-available",
            toolCallId: "failure-tool",
            toolName: "searchPapers",
            input: { query: "literature review" },
          },
          {
            type: "tool-output-error",
            toolCallId: "failure-tool",
            errorText: "The source is unavailable. Try again later.",
          }
        )
      } else {
        chunks.push({ type: "reasoning-start", id: "thought" })
        for (const delta of [
          "Checking the question. ",
          "Comparing the available sources. ",
          "Preparing a concise answer. ",
        ])
          chunks.push({ type: "reasoning-delta", id: "thought", delta })
        chunks.push(
          { type: "reasoning-end", id: "thought" },
          {
            type: "tool-input-start",
            toolCallId: "search-live",
            toolName: "searchPapers",
          },
          {
            type: "tool-input-delta",
            toolCallId: "search-live",
            inputTextDelta: '{"query":"review"}',
          },
          {
            type: "tool-input-available",
            toolCallId: "search-live",
            toolName: "searchPapers",
            input: { query: "review" },
          },
          {
            type: "tool-output-available",
            toolCallId: "search-live",
            output: { papers: 3 },
          },
          { type: "text-start", id: "reply" }
        )
        for (const delta of [
          "Here is a reproducible approach.\n\n",
          ...Array.from(
            { length: request === "Long response" ? 20 : 3 },
            (_, i) =>
              `${i + 1}. Record the search terms and document what changed. 中文说明与 English text align.\n\n`
          ),
        ])
          chunks.push({ type: "text-delta", id: "reply", delta })
        chunks.push({ type: "text-end", id: "reply" })
      }
      chunks.push(
        { type: "finish-step" },
        { type: "finish", finishReason: "stop" }
      )
      return simulateReadableStream({
        chunks,
        initialDelayInMs: 200,
        chunkDelayInMs: request === "Long response" ? 1500 : 450,
      }).pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            if (!abortSignal?.aborted) controller.enqueue(chunk)
          },
        })
      )
    },
  }
}

export default function ChatUIFixture() {
  const { theme, setTheme } = useTheme()
  const [narrow, setNarrow] = useState(false)
  const [selectedBotId, setSelectedBotId] = useState("paul")
  const transport = useMemo(() => makeTransport(), [])
  const {
    messages,
    setMessages,
    sendMessage,
    addToolApprovalResponse,
    status,
    stop,
    error,
  } = useChat({
    id: "isolated-chat-ui",
    messages: overview,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })
  const busy = status === "submitted" || status === "streaming"
  return (
    <div className="h-dvh bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <span className="text-xs text-muted-foreground">
          Isolated UI fixture · {status}
        </span>
        <Button
          size="sm"
          variant="outline"
          title="Switch theme"
          onClick={() =>
            setTheme(
              theme === "dark" ? "light" : theme === "light" ? "system" : "dark"
            )
          }
        >
          Theme
        </Button>
        <Button size="sm" variant="outline" onClick={() => setNarrow(!narrow)}>
          Width
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setMessages(messageExample)}
        >
          Message example
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setMessages(overview)}
        >
          Reset
        </Button>
        {["Stream response", "Long response", "Approval", "Failure"].map(
          (text) => (
            <Button
              key={text}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void sendMessage({ text, metadata: { botId: "paul" } })
              }
            >
              {text}
            </Button>
          )
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!busy}
          onClick={() => void stop()}
        >
          Stop
        </Button>
      </div>
      <div
        className={cn(
          "mx-auto flex h-[calc(100dvh-56px)] max-w-4xl flex-col",
          narrow && "max-w-[375px]"
        )}
      >
        <ChatTranscript
          messages={messages}
          bots={bots}
          isGroup
          status={status}
          pendingBotId={selectedBotId}
          onApproval={addToolApprovalResponse}
        />
        {error && <p role="alert">{error.message}</p>}
        <div className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6">
          <ChatComposer
            bots={bots}
            selectedBotId={selectedBotId}
            onBotChange={setSelectedBotId}
            status={status}
            onStop={() => void stop()}
            onSubmit={async ({ text }) => {
              if (!text.trim() || busy) return
              await sendMessage({ text, metadata: { botId: selectedBotId } })
            }}
          />
        </div>
      </div>
    </div>
  )
}
