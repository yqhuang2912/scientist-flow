"use client"

// Local visual fixture: no database, filesystem, model or task requests.
import { useState } from "react"
import { useTheme } from "next-themes"
import { FolderIcon, MoreHorizontalIcon } from "lucide-react"
import ChatUIFixture from "./chat-ui"
import WorkspaceFileTreeFixture from "./workspace-file-tree"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
} from "@/components/ui/item"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { DocumentEditor } from "@/components/document-editor"
import { DocumentMarkdown } from "@/components/document-markdown"

const formats = ["Markdown", "Plain text", "Python", "中文文档"]
const initialSource =
  "# Research notes · 研究记录\n\nEnglish and 中文 share a comfortable reading width.\n\n## Reproducibility\n\n- Record the method.\n- 保存实验条件，不修改原始数据。\n\n```python\ndef analyse(values):\n    return sum(values)\n```\n"

export default function VisualSystemFixture() {
  const { resolvedTheme, setTheme } = useTheme()
  const [page, setPage] = useState("Controls")
  const [enabled, setEnabled] = useState(false)
  const [value, setValue] = useState<string | null>("Markdown")
  const [source, setSource] = useState(initialSource)
  const [mode, setMode] = useState("preview")
  const [saved, setSaved] = useState(initialSource)
  const [menuAction, setMenuAction] = useState("No action")
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <nav
        aria-label="Visual audit"
        className="sticky top-0 z-20 flex flex-wrap gap-2 border-b bg-background p-2"
      >
        {["Controls", "Chat", "Tree", "Document"].map((label) => (
          <Button
            key={label}
            size="sm"
            variant={page === label ? "secondary" : "ghost"}
            onClick={() => setPage(label)}
          >
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          Theme
        </Button>
      </nav>
      {page === "Chat" ? (
        <ChatUIFixture />
      ) : page === "Tree" ? (
        <WorkspaceFileTreeFixture />
      ) : page === "Document" ? (
        <section
          aria-label="Isolated document"
          className="mx-auto my-5 flex min-h-[70vh] max-w-4xl flex-col overflow-hidden rounded-3xl border bg-background shadow-xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <span className="type-control-compact">
              notes.md
              {source !== saved ? " · Unsaved" : " · Saved in fixture memory"}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setMode(mode === "preview" ? "source" : "preview")
                }
              >
                {mode === "preview" ? "Source" : "Preview"}
              </Button>
              <Button
                size="sm"
                disabled={source === saved}
                onClick={() => setSaved(source)}
              >
                Save in memory
              </Button>
            </div>
          </div>
          <div hidden={mode !== "source"} className="min-h-80">
            <DocumentEditor
              value={source}
              language="markdown"
              readOnly={false}
              label="Isolated source"
              onChange={setSource}
              onSave={() => setSaved(source)}
            />
          </div>
          <div
            hidden={mode !== "preview"}
            className="mx-auto w-full max-w-3xl p-5"
          >
            <DocumentMarkdown content={source} />
          </div>
        </section>
      ) : (
        <div className="mx-auto grid max-w-4xl gap-6 p-5 md:grid-cols-2">
          <section className="space-y-4" aria-label="Controls">
            <Field>
              <FieldLabel htmlFor="audit-format">Format · 格式</FieldLabel>
              <Combobox items={formats} value={value} onValueChange={setValue}>
                <ComboboxInput
                  id="audit-format"
                  placeholder="Choose a format"
                  showClear
                />
                <ComboboxContent>
                  <ComboboxEmpty>No formats</ComboboxEmpty>
                  <ComboboxList>
                    {(item: string) => (
                      <ComboboxItem key={item} value={item}>
                        {item}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="audit-switch">Notifications</FieldLabel>
              <Switch
                id="audit-switch"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="audit-switch-sm">Compact switch</FieldLabel>
              <Switch id="audit-switch-sm" size="sm" defaultChecked />
            </Field>
            <div className="flex gap-2">
              <Badge>Default</Badge>
              <Badge size="compact" variant="secondary">
                Ready
              </Badge>
              <Badge size="count" variant="outline">
                3
              </Badge>
            </div>
            <Tabs defaultValue="preview">
              <TabsList>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="source">Source</TabsTrigger>
                <TabsTrigger value="disabled" disabled>
                  Disabled
                </TabsTrigger>
              </TabsList>
              <TabsContent value="preview">Preview selected</TabsContent>
              <TabsContent value="source">Source selected</TabsContent>
            </Tabs>
            <Tabs defaultValue="files">
              <TabsList density="panel">
                <TabsTrigger value="files">Files</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="files">Panel density</TabsContent>
              <TabsContent value="activity">Activity selected</TabsContent>
            </Tabs>
            <Tabs orientation="vertical" defaultValue="general">
              <TabsList>
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="workspace">Workspace</TabsTrigger>
              </TabsList>
              <TabsContent value="general">Vertical tabs</TabsContent>
              <TabsContent value="workspace">Workspace selected</TabsContent>
            </Tabs>
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Sample menu"
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => setMenuAction("Open")}>
                    Open
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>Unavailable</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setMenuAction("Fixture only")}
                  >
                    Delete sample
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Dialog>
                <DialogTrigger render={<Button variant="outline" size="sm" />}>
                  Sample dialog
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New folder</DialogTitle>
                    <DialogDescription>root: docs/research</DialogDescription>
                  </DialogHeader>
                  <p className="text-sm">
                    Local presentation fixture. No files are created.
                  </p>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>
                      Cancel
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <output className="text-xs text-muted-foreground">
              {menuAction}
            </output>
          </section>
          <section className="space-y-4" aria-label="Surfaces">
            <Card variant="resource">
              <CardHeader>
                <CardTitle>Research reference</CardTitle>
                <CardDescription>
                  Content-sized resource surface. 中文描述自然换行，不固定高度。
                </CardDescription>
              </CardHeader>
            </Card>
            <Item variant="resource">
              <ItemContent>
                <ItemTitle>Document resource</ItemTitle>
                <ItemDescription>
                  A compact row with an intrinsic height.
                </ItemDescription>
              </ItemContent>
            </Item>
            <Progress value={40}>
              <ProgressLabel>Processing</ProgressLabel>
              <ProgressValue />
            </Progress>
            <Progress value={70} size="sm" aria-label="Compact progress" />
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderIcon />
                </EmptyMedia>
                <EmptyTitle>No files yet</EmptyTitle>
                <EmptyDescription>
                  Create a folder to organise this task.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </section>
        </div>
      )}
    </main>
  )
}
