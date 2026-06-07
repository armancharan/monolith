import { spawn } from "node:child_process"
import type { MonolithState, StateResource } from "@monolith/core"
import { Effect } from "effect"
import { CloudflareAuthError } from "./errors.js"
import { CloudflareApiError } from "./errors.js"
import { resolveCloudflareAuth } from "./auth.js"
import {
  makeCloudflareClient,
  type CloudflareClient
} from "./services/CloudflareClient.js"
import type { Context } from "effect"

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

export type CloudflareClientService = Context.Service.Shape<typeof CloudflareClient>

export type RunWranglerDeploymentsList = (
  projectDir: string,
  workerName: string,
  configPath?: string
) => Effect.Effect<WranglerDeploymentRow[], string>

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

export function bindingsToStateResources(
  workerName: string,
  bindings: RawCloudBinding[] | undefined
): StateResource[] {
  const resources: StateResource[] = [
    {
      id: `worker:${workerName}`,
      kind: "worker",
      name: workerName
    }
  ]

  for (const binding of bindings ?? []) {
    const name = binding.name?.trim()
    const type = binding.type?.trim()
    if (!name || !type) {
      continue
    }

    switch (type) {
      case "d1": {
        const databaseId = binding.id?.trim()
        if (!databaseId) {
          break
        }
        resources.push({
          id: `d1:${name}`,
          kind: "d1",
          binding: name,
          name,
          databaseId
        })
        break
      }
      case "kv_namespace": {
        const namespaceId = binding.namespace_id?.trim() ?? binding.id?.trim()
        if (!namespaceId) {
          break
        }
        resources.push({
          id: `kv:${name}`,
          kind: "kv",
          binding: name,
          namespaceId
        })
        break
      }
      case "r2_bucket": {
        const bucketName = binding.bucket_name?.trim()
        resources.push({
          id: `r2:${name}`,
          kind: "r2",
          binding: name,
          bucketName
        })
        break
      }
      case "queue": {
        const queueName = binding.queue_name?.trim()
        resources.push({
          id: `queue:${name}`,
          kind: "queue",
          binding: name,
          name: queueName ?? name
        })
        break
      }
      case "durable_object_namespace": {
        const className = binding.class_name?.trim()
        if (!className) {
          break
        }
        resources.push({
          id: `durable_object:${name}`,
          kind: "durable_object",
          binding: name,
          name: className,
          className,
          scriptName: binding.script_name?.trim()
        })
        break
      }
      default:
        break
    }
  }

  return resources
}

function resolveClient(
  options: { projectDir: string; client?: CloudflareClientService }
): Effect.Effect<CloudflareClientService, CloudflareAuthError> {
  if (options.client) {
    return Effect.succeed(options.client)
  }

  return Effect.gen(function* () {
    const resolvedAuth = yield* resolveCloudflareAuth({ projectDir: options.projectDir })
    return makeCloudflareClient({
      token: resolvedAuth.token,
      auth: resolvedAuth
    })
  })
}

export function readActualWorker(
  client: CloudflareClientService,
  accountId: string,
  workerName: string
): Effect.Effect<StateResource[], CloudflareApiError> {
  return Effect.gen(function* () {
    const settings = yield* readWorkerSettingsFromApi(client, accountId, workerName)
    return bindingsToStateResources(workerName, settings.bindings)
  })
}

export interface ReadActualStackOptions {
  state: MonolithState
  projectDir: string
  accountId?: string
  client?: CloudflareClientService
}

export function readActualStack(
  options: ReadActualStackOptions
): Effect.Effect<
  MonolithState,
  CloudflareAuthError | CloudflareApiError | string
> {
  return Effect.gen(function* () {
    const workerName = workerNameFromState(options.state)
    if (!workerName) {
      return yield* Effect.fail("State has no worker name to read from cloud")
    }

    const client = yield* resolveClient(options)

    let accountId = options.accountId
    if (!accountId) {
      accountId = yield* client.getAccountId()
    }

    const resources = yield* readActualWorker(client, accountId!, workerName)

    return {
      stackName: options.state.stackName,
      stage: options.state.stage,
      resources,
      updatedAt: new Date().toISOString()
    }
  })
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

export function readWorkerSettingsFromApi(
  client: CloudflareClientService,
  accountId: string,
  workerName: string
): Effect.Effect<WorkerSettingsResponse, CloudflareApiError> {
  return client.request<WorkerSettingsResponse>(
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/settings`
  )
}

export function runWranglerDeploymentsList(
  projectDir: string,
  workerName: string,
  configPath?: string
): Effect.Effect<WranglerDeploymentRow[], string> {
  const wranglerArgs = ["wrangler", "deployments", "list", "--name", workerName, "--json"]
  if (configPath) {
    wranglerArgs.push("--config", configPath)
  }

  return Effect.gen(function* () {
    const outcome = yield* Effect.tryPromise({
      try: () =>
        new Promise<{ code: number; output: string; errorOutput: string }>((resolve, reject) => {
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
            resolve({ code: code ?? 1, output, errorOutput })
          })

          child.on("error", (error) => {
            reject(error.message)
          })
        }),
      catch: (cause) => String(cause)
    })

    if (outcome.code !== 0) {
      const message =
        outcome.errorOutput.trim() ||
        outcome.output.trim() ||
        `wrangler exited with code ${outcome.code}`
      return yield* Effect.fail(message)
    }

    try {
      const parsed = JSON.parse(outcome.output) as WranglerDeploymentRow[] | WranglerDeploymentRow
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return yield* Effect.fail("Could not parse wrangler deployments list JSON output")
    }
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
  client?: CloudflareClientService
  configPath?: string
  runWranglerDeployments?: RunWranglerDeploymentsList
}

export function readCloudWorker(
  options: ReadCloudWorkerOptions
): Effect.Effect<
  CloudWorkerReadResult,
  CloudflareAuthError | CloudflareApiError | string
> {
  return Effect.gen(function* () {
    const workerName = workerNameFromState(options.state)
    if (!workerName) {
      return yield* Effect.fail("State has no worker name to read from cloud")
    }

    const client = yield* resolveClient(options)

    const resolvedAccountId = options.accountId ?? (yield* client.getAccountId())

    const limitations: string[] = [...READ_LIMITATIONS]
    const runDeployments = options.runWranglerDeployments ?? runWranglerDeploymentsList

    const settingsResult = yield* Effect.result(
      readWorkerSettingsFromApi(client, resolvedAccountId, workerName)
    )

    let bindings: CloudBindingHint[] | undefined
    let compatibilityDate: string | undefined
    let completeness: CloudWorkerReadResult["completeness"] = "deployments_only"

    if (settingsResult._tag === "Success") {
      bindings = normalizeCloudBindings(settingsResult.success.bindings)
      compatibilityDate = settingsResult.success.compatibility_date
      completeness = bindings.length > 0 ? "full" : "partial"
    } else if (settingsResult.failure.status === 404) {
      limitations.push(
        "Worker script not found in Cloudflare account — may never have been deployed."
      )
    } else {
      limitations.push(`Worker settings API unavailable: ${settingsResult.failure.message}`)
    }

    const deploymentsResult = yield* Effect.result(
      runDeployments(options.projectDir, workerName, options.configPath)
    )

    let latestDeployment: CloudDeploymentHint | undefined
    if (deploymentsResult._tag === "Success") {
      latestDeployment = latestDeploymentFromRows(deploymentsResult.success)
      if (completeness === "deployments_only" && latestDeployment) {
        completeness = "partial"
      }
    } else {
      limitations.push(`Wrangler deployments list unavailable: ${deploymentsResult.failure}`)
    }

    if (settingsResult._tag === "Failure" && deploymentsResult._tag === "Failure") {
      return yield* Effect.fail(settingsResult.failure.message)
    }

    return {
      workerName,
      accountId: resolvedAccountId,
      completeness,
      latestDeployment,
      bindings,
      compatibilityDate,
      limitations
    }
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
