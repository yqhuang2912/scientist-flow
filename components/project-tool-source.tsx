import type { ToolEvidence } from "@/lib/project-decisions"

export function ProjectToolSource({ evidence }: { evidence: ToolEvidence }) {
  return (
    <div className="space-y-1 border-l-2 pl-3 text-xs text-muted-foreground">
      <p className="wrap-anywhere">
        {evidence.toolName} · {evidence.toolCallId}
      </p>
      {evidence.fields.map(({ path, value }) => (
        <p key={path} className="wrap-anywhere">
          <code>{path}</code> ={" "}
          <strong className="font-medium text-foreground">
            {String(value)}
          </strong>
        </p>
      ))}
    </div>
  )
}
