import type { MonolithState, StateResource } from "@monolith/core"
import { spawn } from "node:child_process"
import { CloudflareClient } from "./client.js"
import type { CloudflareApiError } from "./client.js"
import { CloudflareAuthError } from "./auth.js"
import { err, ok, type Result } from "./result.js"

export interface CloudBindingHint {
  name: string
  type: string
  resourceId?: string
}

export interface CloudDeploymentHint {
  id?: string
  createdAt?: string
  source?: string
}

export interface CloudWorkerReadResult {
  workerName: string
  accountId: string
  completeness: "full" | "partial" | "deployments_only"
  latestDeployment?: CloudDeploymentHint
  bindings?: CloudBindingHint[]
  compatibilityDate?: string
  limitations: string[]
}

export interface CloudDriftHints {
  read?: CloudWorkerReadResult
  skippedReason?: string
  hints: string[]
}

interface RawCloudBinding {
  name?: string
  type?: string
  id?: string
  namespace_id?: string
  bucket_name?: string
  class_name?: string
  script_name?: string
  queue_name?: string
}

interface WorkerSettingsResponse {
  bindings?: RawCloudBinding[]
  compatibility_date?: string
}

interface WranglerDeploymentRow {
  Id?: string
  id?: string
  Created?: string
  created_on?: string
  Source?: string
  source?: string
}

export type RunWranglerDeploymentsList = (
  projectDir: string,
  workerName: string,
  configPath?: string
) => Promise<Result<WranglerDeploymentRow[], string>>

const READ_LIMITATIONS = [
  "Cloud read compares binding names/types only — binding target IDs may differ without surfacing here.",
  "Dashboard-only edits to routes, secrets, and vars are not detected.",
  "Durable Object migrations and queue consumers are not fully reconciled."
] as const

function workerNameFromState(state: MonolithState): string | undefined {
  const worker = state.resources.find((resource) => resource.kind === "worker")
  return worker?.name ?? state.stackName
}

function normalizeBindingType(type: string): string {
  switch (type) {
    case "kv_namespace":
      return "kv"
    case "d1":
      return "d1"
    case "r2_bucket":
      return "r2"
    case "queue":
      return "queue"
    case "durable_object_namespace":
      return "durable_object"
    default:
      return type
  }
}

function bindingResourceId(binding: RawCloudBinding): string | undefined {
  return (
    binding.id ??
    binding.namespace_id ??
    binding.bucket_name ??
    binding.queue_name ??
    binding.class_name
  )
}

function normalizeCloudBindings(bindings: RawCloudBinding[] | undefined): CloudBindingHint[] {
  if (!bindings) {
    return []
  }

  return bindings.flatMap((binding) => {
    const name = binding.name?.trim()
    const type = binding.type?.trim()
    if (!name || !type) {
      return []
    }
    return [{
      name,
      type: normalizeBindingType(type),
      resourceId: bindingResourceId(binding)
    }]
  })
}

export async function readWorkerSettingsFromApi(
  client: CloudflareClient,
  accountId: string,
  workerName: string
): Promise<Result<WorkerSettingsResponse, CloudflareApiError>> {
  return client.request<WorkerSettingsResponse>(
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/settings`
  )
}

export async function runWranglerDeploymentsList(
  projectDir: string,
  workerName: string,
  configPath?: string
): Promise<Result<WranglerDeploymentRow[], string>> {
  const wranglerArgs = ["wrangler", "deployments", "list", "--name", workerName, "--json"]
  if (configPath) {
    wranglerArgs.push("--config", configPath)
  }

  return new Promise((resolve) => {
    const child = spawn("npx", wranglerArgs, {
      cwd: projectDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    })

    let output = ""
    let errorOutput = ""

    child.stdout?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString()
    })

    child.stderr?.on("data", (chunk: Buffer | string) => {
      errorOutput += chunk.toString()
    })

    child.on("close", (code) => {
      if (code !== 0) {
        const message = errorOutput.trim() || output.trim() || `wrangler exited with code ${code ?? 1}`
        resolve(err(message))
        return
      }

      try {
        const parsed = JSON.parse(output) as WranglerDeploymentRow[] | WranglerDeploymentRow
        const rows = Array.isArray(parsed) ? parsed : [parsed]
        resolve(ok(rows))
      } catch {
        resolve(err("Could not parse wrangler deployments list JSON output"))
      }
    })

    child.on("error", (error) => {
      resolve(err(error.message))
    })
  })
}

function latestDeploymentFromRows(rows: WranglerDeploymentRow[]): CloudDeploymentHint | undefined {
  const first = rows[0]
  if (!first) {
    return undefined
  }

  return {
    id: first.Id ?? first.id,
    createdAt: first.Created ?? first.created_on,
    source: first.Source ?? first.source
  }
}

export interface ReadCloudWorkerOptions {
  state: MonolithState
  projectDir: string
  accountId?: string
  client?: CloudflareClient
  configPath?: string
  runWranglerDeployments?: RunWranglerDeploymentsList
}

export async function readCloudWorker(
  options: ReadCloudWorkerOptions
): Promise<Result<CloudWorkerReadResult, CloudflareAuthError | CloudflareApiError | string>> {
  const workerName = workerNameFromState(options.state)
  if (!workerName) {
    return err("State has no worker name to read from cloud")
  }

  let client = options.client
  if (!client) {
    const clientResult = await CloudflareClient.create({ projectDir: options.projectDir })
    if (!clientResult.ok) {
      return clientResult
    }
    client = clientResult.value
  }

  let accountId = options.accountId
  if (!accountId) {
    const accountResult = await client.getAccountId()
    if (!accountResult.ok) {
      return accountResult
    }
    accountId = accountResult.value
  }

  const limitations: string[] = [...READ_LIMITATIONS]
  const runDeployments = options.runWranglerDeployments ?? runWranglerDeploymentsList

  const settingsResult = await readWorkerSettingsFromApi(client, accountId, workerName)
  let bindings: CloudBindingHint[] | undefined
  let compatibilityDate: string | undefined
  let completeness: CloudWorkerReadResult["completeness"] = "deployments_only"

  if (settingsResult.ok) {
    bindings = normalizeCloudBindings(settingsResult.value.bindings)
    compatibilityDate = settingsResult.value.compatibility_date
    completeness = bindings.length > 0 ? "full" : "partial"
  } else if (settingsResult.error.status === 404) {
    limitations.push("Worker script not found in Cloudflare account — may never have been deployed.")
  } else {
    limitations.push(`Worker settings API unavailable: ${settingsResult.error.message}`)
  }

  const deploymentsResult = await runDeployments(
    options.projectDir,
    workerName,
    options.configPath
  )

  let latestDeployment: CloudDeploymentHint | undefined
  if (deploymentsResult.ok) {
    latestDeployment = latestDeploymentFromRows(deploymentsResult.value)
    if (completeness === "deployments_only" && latestDeployment) {
      completeness = "partial"
    }
  } else {
    limitations.push(`Wrangler deployments list unavailable: ${deploymentsResult.error}`)
  }

  if (!settingsResult.ok && !deploymentsResult.ok) {
    return err(
      settingsResult.ok
        ? deploymentsResult.error
        : settingsResult.error.message
    )
  }

  return ok({
    workerName,
    accountId,
    completeness,
    latestDeployment,
    bindings,
    compatibilityDate,
    limitations
  })
}

function bindingResources(state: MonolithState): StateResource[] {
  return state.resources.filter((resource) => resource.kind !== "worker")
}

function cloudBindingKey(binding: CloudBindingHint): string {
  return `${binding.type}:${binding.name}`
}

function stateBindingKey(resource: StateResource): string {
  return `${resource.kind}:${resource.binding ?? resource.name ?? resource.id}`
}

export function buildCloudDriftHints(
  state: MonolithState,
  read?: CloudWorkerReadResult
): CloudDriftHints {
  if (!read) {
    return { hints: [] }
  }

  const hints: string[] = []
  const localBindings = bindingResources(state)
  const cloudBindings = read.bindings ?? []

  if (read.latestDeployment?.id) {
    hints.push(`Cloud deployment: ${read.latestDeployment.id}`)
    if (read.latestDeployment.createdAt) {
      hints.push(`  Created: ${read.latestDeployment.createdAt}`)
    }
  } else if (read.completeness === "deployments_only") {
    hints.push("Cloud: worker settings unreadable; deployment metadata only.")
  }

  if (state.deployedAt && read.latestDeployment?.createdAt) {
    const stateTime = Date.parse(state.deployedAt)
    const cloudTime = Date.parse(read.latestDeployment.createdAt)
    if (!Number.isNaN(stateTime) && !Number.isNaN(cloudTime) && cloudTime > stateTime) {
      hints.push(
        "Cloud deployment is newer than state.deployedAt — dashboard or external deploy may have occurred."
      )
    }
  }

  const localKeys = new Set(localBindings.map(stateBindingKey))
  const cloudKeys = new Set(cloudBindings.map(cloudBindingKey))

  for (const binding of cloudBindings) {
    const key = cloudBindingKey(binding)
    if (!localKeys.has(key)) {
      hints.push(`Cloud binding not in local state: ${binding.type} ${binding.name}`)
    }
  }

  for (const resource of localBindings) {
    const key = stateBindingKey(resource)
    if (cloudBindings.length > 0 && !cloudKeys.has(key)) {
      hints.push(`Local binding not seen in cloud settings: ${resource.kind} ${resource.binding ?? resource.id}`)
    }
  }

  if (cloudBindings.length === 0 && localBindings.length > 0 && read.completeness !== "deployments_only") {
    hints.push("Cloud reports zero bindings but local state has bindings — verify worker name/account.")
  }

  if (hints.length === 0) {
    hints.push("Cloud metadata matches local state at binding-name level (partial check).")
  }

  return { read, hints }
}

export function formatCloudDriftHints(section: CloudDriftHints): string {
  const lines: string[] = []

  if (section.skippedReason) {
    lines.push("")
    lines.push("Cloud drift (skipped)")
    lines.push(`  ${section.skippedReason}`)
    return lines.join("\n")
  }

  if (!section.read) {
    return ""
  }

  lines.push("")
  lines.push("Cloud drift (partial)")
  lines.push(`  Worker: ${section.read.workerName} (account ${section.read.accountId})`)
  lines.push(`  Read completeness: ${section.read.completeness}`)

  if (section.read.compatibilityDate) {
    lines.push(`  Compatibility date: ${section.read.compatibilityDate}`)
  }

  if (section.read.bindings && section.read.bindings.length > 0) {
    lines.push(`  Bindings in cloud (${section.read.bindings.length}):`)
    for (const binding of section.read.bindings) {
      const idSuffix = binding.resourceId ? ` → ${binding.resourceId}` : ""
      lines.push(`    - ${binding.type} ${binding.name}${idSuffix}`)
    }
  }

  lines.push("")
  lines.push("  Hints:")
  for (const hint of section.hints) {
    lines.push(`    - ${hint}`)
  }

  lines.push("")
  lines.push("  Limitations:")
  for (const limitation of section.read.limitations) {
    lines.push(`    - ${limitation}`)
  }

  return lines.join("\n")
}
