import type { MonolithState, StateResource } from "./state.js"

export type PlanChangeType = "create" | "update" | "delete"

export interface FieldChange {
  field: string
  from: string | undefined
  to: string | undefined
}

export interface PlanChange {
  type: PlanChangeType
  resource: StateResource
  fieldChanges?: FieldChange[]
  bindingChange?: boolean
}

export type PlanDesiredSource = "stack" | "wrangler" | "import"

export interface PlanResult {
  hasChanges: boolean
  changes: PlanChange[]
  desiredSource: PlanDesiredSource
}

const BINDING_KINDS = new Set(["d1", "kv", "r2", "queue"])

const COMPARE_FIELDS: Record<string, readonly (keyof StateResource)[]> = {
  worker: ["name"],
  d1: ["binding", "name", "databaseId"],
  kv: ["binding", "namespaceId"],
  r2: ["binding", "bucketName"],
  queue: ["binding", "name"]
}

function resourceIndex(resources: readonly StateResource[]): Map<string, StateResource> {
  return new Map(resources.map((resource) => [resource.id, resource]))
}

function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  return String(value)
}

function diffResource(current: StateResource, desired: StateResource): FieldChange[] {
  const fields = COMPARE_FIELDS[current.kind] ?? COMPARE_FIELDS[desired.kind] ?? ["name"]
  const changes: FieldChange[] = []

  for (const field of fields) {
    const from = formatValue(current[field])
    const to = formatValue(desired[field])
    if (from !== to) {
      changes.push({ field, from, to })
    }
  }

  return changes
}

function isBindingResource(resource: StateResource): boolean {
  return BINDING_KINDS.has(resource.kind)
}

function hasBindingFieldChange(fieldChanges: FieldChange[]): boolean {
  return fieldChanges.some((change) => change.field === "binding")
}

export function planState(current: MonolithState, desired: MonolithState): PlanResult {
  const currentById = resourceIndex(current.resources)
  const desiredById = resourceIndex(desired.resources)
  const changes: PlanChange[] = []

  for (const [id, resource] of desiredById) {
    const existing = currentById.get(id)
    if (!existing) {
      changes.push({
        type: "create",
        resource,
        bindingChange: isBindingResource(resource)
      })
      continue
    }

    const fieldChanges = diffResource(existing, resource)
    if (fieldChanges.length > 0) {
      changes.push({
        type: "update",
        resource,
        fieldChanges,
        bindingChange:
          isBindingResource(resource) &&
          (hasBindingFieldChange(fieldChanges) || existing.binding !== resource.binding)
      })
    }
  }

  for (const [id, resource] of currentById) {
    if (!desiredById.has(id)) {
      changes.push({
        type: "delete",
        resource,
        bindingChange: isBindingResource(resource)
      })
    }
  }

  changes.sort((left, right) => {
    const order: Record<PlanChangeType, number> = { create: 0, update: 1, delete: 2 }
    const typeOrder = order[left.type] - order[right.type]
    if (typeOrder !== 0) {
      return typeOrder
    }
    return left.resource.id.localeCompare(right.resource.id)
  })

  return {
    hasChanges: changes.length > 0,
    changes,
    desiredSource: "import"
  }
}

function describeResource(resource: StateResource): string {
  const parts = [resource.kind, resource.id]
  if (resource.binding) {
    parts.push(`binding=${resource.binding}`)
  }
  return parts.join(" ")
}

function formatFieldChange(change: FieldChange): string {
  const from = change.from ?? "(none)"
  const to = change.to ?? "(none)"
  if (change.field === "binding") {
    return `binding: ${from} → ${to}`
  }
  return `${change.field}: ${from} → ${to}`
}

export function formatPlan(
  stage: string,
  current: MonolithState,
  result: PlanResult
): string {
  const lines = [
    `Plan for stage "${stage}" (stack: ${current.stackName})`,
    `Desired source: ${
      result.desiredSource === "stack"
        ? "monolith.run.ts (merged with import/wrangler IDs)"
        : result.desiredSource === "wrangler"
          ? "wrangler config (re-import)"
          : "import snapshot"
    }`
  ]

  if (!result.hasChanges) {
    lines.push("")
    lines.push("No changes. Infrastructure matches desired state.")
    return lines.join("\n")
  }

  lines.push("")
  lines.push("Changes:")

  for (const change of result.changes) {
    const prefix =
      change.type === "create" ? "+" : change.type === "update" ? "~" : "-"
    const label = change.type === "create" ? "create" : change.type === "update" ? "update" : "delete"
    lines.push(`  ${prefix} ${label} ${describeResource(change.resource)}`)

    if (change.bindingChange) {
      lines.push("      [binding change]")
    }

    for (const fieldChange of change.fieldChanges ?? []) {
      const marker = fieldChange.field === "binding" ? "      * " : "      "
      lines.push(`${marker}${formatFieldChange(fieldChange)}`)
    }
  }

  return lines.join("\n")
}
