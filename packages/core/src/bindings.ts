import type { StateResource } from "./state.js"

export interface BindingSummaryEntry {
  kind: string
  binding?: string
  name?: string
  shared: boolean
}

export function summarizeBindings(
  resources: StateResource[],
  options?: { previewStage?: boolean }
): BindingSummaryEntry[] {
  const preview = options?.previewStage ?? false
  const entries: BindingSummaryEntry[] = []

  for (const resource of resources) {
    if (resource.kind === "worker") {
      entries.push({
        kind: "worker",
        name: resource.name,
        shared: !preview
      })
      continue
    }

    entries.push({
      kind: resource.kind,
      binding: resource.binding,
      name: resource.name ?? resource.bucketName ?? resource.className,
      shared: true
    })
  }

  return entries
}

export function formatBindingSummary(
  entries: BindingSummaryEntry[],
  options?: { previewStage?: boolean }
): string {
  if (entries.length === 0) {
    return "  Bindings: (none)"
  }

  const lines = entries.map((entry) => {
    const label = entry.binding
      ? `${entry.kind}:${entry.binding}`
      : entry.kind === "worker"
        ? `worker:${entry.name ?? "?"}`
        : entry.kind
  const isolation = entry.shared ? "shared" : "isolated"
  return `    - ${label} (${isolation})`
  })

  const header = options?.previewStage
    ? "  Bindings (preview: worker isolated, storage shared):"
    : "  Bindings:"

  return [header, ...lines].join("\n")
}
