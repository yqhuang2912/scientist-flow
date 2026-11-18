"use client"

import { WrenchIcon } from "lucide-react"
import type { Ref } from "react"
import { deleteTool } from "@/actions/tool"
import { getTool, getTools } from "@/queries/tools"
import type { ToolDefinition } from "@/db/schema"
import type { ParameterSchema } from "@/lib/tool-definition"
import type { SettingsLeaveGuard } from "@/components/settings-form-guard"
import { SharedLibraryPanel } from "@/components/shared-library-panel"
import { ToolForm } from "@/components/tool-form"

function Parameters({ schema }: { schema: ParameterSchema }) {
  if (schema.type === "array" && schema.items)
    return <Parameters schema={schema.items} />
  const entries = Object.entries(schema.properties ?? {})
  if (!entries.length) return null
  return (
    <dl className="min-w-0 space-y-2 border-l pl-3">
      {entries.map(([name, parameter]) => (
        <div key={name}>
          <dt className="flex flex-wrap items-baseline gap-x-2">
            <code className="text-xs font-medium wrap-anywhere">{name}</code>
            <span className="text-xs text-muted-foreground">
              {parameter.type === "array"
                ? parameter.items?.type + "[]"
                : parameter.type}{" "}
              · {schema.required?.includes(name) ? "Required" : "Optional"}
            </span>
          </dt>
          <dd className="text-xs leading-5 wrap-anywhere text-muted-foreground">
            {parameter.description}
            {parameter.enum && (
              <div>
                Choices ·{" "}
                {parameter.enum.map((v) => JSON.stringify(v)).join(", ")}
              </div>
            )}
            <Parameters schema={parameter} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ToolDetails({ tool }: { tool: ToolDefinition }) {
  const { config, inputSchema } = tool
  return (
    <div className="space-y-4">
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">HTTP API</dt>
        <dd className="font-mono wrap-anywhere">
          {config.method} {config.url}
        </dd>
        <dt className="text-muted-foreground">Authentication</dt>
        <dd className="wrap-anywhere">
          {config.auth.type === "none" ? (
            "None"
          ) : (
            <>
              Bearer · <code>{config.auth.envVar}</code>
            </>
          )}
        </dd>
      </dl>
      <section className="space-y-2">
        <h3 className="type-control">Input parameters</h3>
        {Object.keys(inputSchema.properties).length ? (
          <Parameters schema={inputSchema} />
        ) : (
          <p className="text-xs text-muted-foreground">
            No parameters defined.
          </p>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer">View JSON Schema</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-2">
            {JSON.stringify(inputSchema, null, 2)}
          </pre>
        </details>
      </section>
    </div>
  )
}
export function ToolsSettingsPanel({
  guard,
}: {
  guard: Ref<SettingsLeaveGuard>
}) {
  return (
    <SharedLibraryPanel
      noun="tool"
      title="Tools"
      description="Manage shared tool definitions for your bots."
      icon={<WrenchIcon />}
      getList={getTools}
      getEntry={getTool}
      removeEntry={deleteTool}
      identifier={(tool) => tool.name}
      listMeta={() => "HTTP API"}
      renderDetail={(tool) => <ToolDetails tool={tool} />}
      renderForm={(tool, onSaved, onCancel) => (
        <ToolForm
          tool={tool}
          guard={guard}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
    />
  )
}
