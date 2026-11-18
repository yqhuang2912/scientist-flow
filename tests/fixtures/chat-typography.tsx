"use client"

// Read-only typography fixture: no model calls, database writes or task execution.
import { useState } from "react"
import { useTheme } from "next-themes"
import type { UIMessage } from "ai"
import { ChatTranscript } from "@/components/chat-transcript"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const bots = [
  { id: "paul", name: "Paul", job: "Research assistant", avatar: "Paul" },
]
const typographyExample: UIMessage[] = [
  {
    id: "typography-user",
    role: "user",
    metadata: { botId: "paul" },
    parts: [
      {
        type: "text",
        text: "请比较两种研究方法。Use the same input data.\n\n第二段从消息左侧开始，与 @Paul 对齐。",
      },
    ],
  },
  {
    id: "typography-assistant",
    role: "assistant",
    metadata: { botId: "paul" },
    parts: [
      {
        type: "text",
        state: "done",
        text: "使用**相同的输入数据**，记录准确率和运行时间。中文标点、English words 和数字 2026 应自然排列，不额外拉开字符间距。\n\nUse the same input data and record both accuracy and execution time. Keep the comparison reproducible, and explain where each method works best.\n\n### 比较步骤\n\n1. 固定数据和评估方法，较长的条目会自然换行，不在文本之间添加空格。\n2. 重复实验并记录误差。\n   - Report accuracy and execution time.\n   - Keep the evidence separate from the conclusion.\n\n> 这是引用的第一段。\n>\n> This is a second paragraph in the same quotation.\n\n- 第一条包含两个段落。\n\n  这是条目内部的第二段，检查列表内的段落间距。\n\n- 第二条用于比较条目间距。\n\n使用 `result.mean()` 查看结果；代码块继续保留独立的等宽字号。",
      },
    ],
  },
]

export default function ChatTypographyFixture() {
  const [narrow, setNarrow] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <span className="text-xs text-muted-foreground">
          Chat typography - isolated fixture
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          Theme
        </Button>
        <Button size="sm" variant="outline" onClick={() => setNarrow(!narrow)}>
          Width
        </Button>
      </div>
      <div
        className={cn(
          "mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col",
          narrow && "max-w-[375px]"
        )}
      >
        <ChatTranscript
          messages={typographyExample}
          bots={bots}
          isGroup
          status="ready"
        />
      </div>
    </div>
  )
}
