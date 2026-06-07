import {
  StateStore,
  stateFromImportSnapshot,
  type MonolithState
} from "@monolith/core"
import {
  hashWranglerContent,
  parseWranglerConfigText,
  toImportSnapshot
} from "@monolith/cloudflare"
import { WranglerDeployer } from "@monolith/cloudflare"
import { Effect } from "effect"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tryPromiseOr } from "./effect-helpers.js"

export interface WranglerCommandResult {
  exitCode: number
  output: string
}

export type RunWranglerCommand = (
  args: string[],
  projectDir: string
) => Promise<WranglerCommandResult>

const PLACEHOLDER_PREFIX = "REPLACE_"

export function isPlaceholderId(id: string | undefined): boolean {
  if (!id || id.trim() === "") {
    return true
  }
  return id.startsWith(PLACEHOLDER_PREFIX)
}

export function parseD1DatabaseIdFromOutput(output: string): string | undefined {
  const patterns = [
    /database_id\s*=\s*["']?([a-f0-9-]{36})["']?/i,
    /"database_id"\s*:\s*"([a-f0-9-]{36})"/i
  ]
  for (const pattern of patterns) {
    const match = output.match(pattern)
    if (match?.[1]) {
      return match[1]
    }
  }
  return undefined
}

export function parseKvNamespaceIdFromOutput(output: string): string | undefined {
  const patterns = [
    /(?:^|\s)id\s*=\s*["']?([a-f0-9]{32})["']?/im,
    /"id"\s*:\s*"([a-f0-9]{32})"/i
  ]
  for (const pattern of patterns) {
    const match = output.match(pattern)
    if (match?.[1]) {
      return match[1]
    }
  }
  return undefined
}

export const runWranglerCommand = (
  args: string[],
  projectDir: string
): Effect.Effect<WranglerCommandResult, never, WranglerDeployer> =>
  Effect.gen(function* () {
    const deployer = yield* WranglerDeployer
    return yield* deployer.runCommand(["wrangler", ...args], { cwd: projectDir }).pipe(
      Effect.catch((message) => Effect.succeed({ exitCode: 1, output: message }))
    )
  })

interface PendingD1 {
  binding: string
  databaseName: string
}

interface PendingKv {
  binding: string
}

function findPendingResources(configText: string, configPath: string): {
  d1: PendingD1[]
  kv: PendingKv[]
} {
  const parsed = parseWranglerConfigText(configText, configPath)
  const d1 = (parsed.d1Databases ?? [])
    .filter((entry) => isPlaceholderId(entry.databaseId))
    .map((entry) => ({
      binding: entry.binding,
      databaseName: entry.databaseName
    }))

  const kv = (parsed.kvNamespaces ?? [])
    .filter((entry) => isPlaceholderId(entry.id))
    .map((entry) => ({
      binding: entry.binding
    }))

  return { d1, kv }
}

export function needsAutoEnsure(configText: string, configPath: string): boolean {
  const parsed = parseWranglerConfigText(configText, configPath)
  const d1 = (parsed.d1Databases ?? []).some((entry) =>
    entry.databaseId?.startsWith(PLACEHOLDER_PREFIX)
  )
  const kv = (parsed.kvNamespaces ?? []).some((entry) => entry.id?.startsWith(PLACEHOLDER_PREFIX))
  return d1 || kv
}

async function updateWranglerConfigIds(
  configPath: string,
  projectDir: string,
  updates: {
    d1?: Array<{ binding: string; databaseId: string }>
    kv?: Array<{ binding: string; namespaceId: string }>
  }
): Promise<void> {
  const absolutePath = join(projectDir, configPath)
  const content = await readFile(absolutePath, "utf8")
  const config = JSON.parse(content) as Record<string, unknown>

  if (updates.d1?.length) {
    const databases = (config.d1_databases ?? []) as Array<Record<string, string>>
    for (const update of updates.d1) {
      const entry = databases.find((row) => row.binding === update.binding)
      if (entry) {
        entry.database_id = update.databaseId
      }
    }
    config.d1_databases = databases
  }

  if (updates.kv?.length) {
    const namespaces = (config.kv_namespaces ?? []) as Array<Record<string, string>>
    for (const update of updates.kv) {
      const entry = namespaces.find((row) => row.binding === update.binding)
      if (entry) {
        entry.id = update.namespaceId
      }
    }
    config.kv_namespaces = namespaces
  }

  await writeFile(absolutePath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

async function refreshStateFromWrangler(
  stage: string,
  projectDir: string,
  configPath: string,
  current: MonolithState
): Promise<MonolithState> {
  const content = await readFile(join(projectDir, configPath), "utf8")
  const parsed = parseWranglerConfigText(content, configPath)
  const snapshot = toImportSnapshot(parsed, hashWranglerContent(content))
  return stateFromImportSnapshot(snapshot, stage, {
    importSnapshotPath: current.importSnapshotPath,
    wranglerConfigPath: configPath,
    updatedAt: new Date().toISOString()
  })
}

export interface EnsureResourcesOptions {
  stage: string
  projectDir: string
  configPath: string
  ensureResources?: boolean
  runWrangler?: RunWranglerCommand
}

export const ensurePlaceholderResources = (
  options: EnsureResourcesOptions
): Effect.Effect<{ state: MonolithState }, string, StateStore | WranglerDeployer> =>
  Effect.gen(function* () {
    const { stage, projectDir, configPath } = options
    const ensureResourcesFlag = options.ensureResources ?? false
    const stateStore = yield* StateStore
    const deployer = yield* WranglerDeployer

    const stateResult = yield* stateStore.loadState(stage).pipe(
      Effect.catch((error) => Effect.fail(error.message))
    )

    const configText = yield* Effect.catch(
      Effect.tryPromise({
        try: () => readFile(join(projectDir, configPath), "utf8"),
        catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause))
      }),
      (cause) => Effect.fail(cause instanceof Error ? cause.message : String(cause))
    )

    const pending = findPendingResources(configText, configPath)

    if (pending.d1.length === 0 && pending.kv.length === 0) {
      return { state: stateResult }
    }

    const autoEnsure = needsAutoEnsure(configText, configPath)
    if (!autoEnsure && !ensureResourcesFlag) {
      return { state: stateResult }
    }

    console.log("Ensuring Cloudflare resources for placeholder bindings...")

    const d1Updates: Array<{ binding: string; databaseId: string }> = []
    const kvUpdates: Array<{ binding: string; namespaceId: string }> = []

    const runWrangler = options.runWrangler
      ? (args: string[]) =>
          tryPromiseOr(() => options.runWrangler!(args, projectDir), { exitCode: 1, output: "" })
      : (args: string[]) =>
          deployer.runCommand(["wrangler", ...args], { cwd: projectDir }).pipe(
            Effect.catch((message) => Effect.succeed({ exitCode: 1, output: message }))
          )

    for (const entry of pending.d1) {
      console.log(`  Creating D1 database "${entry.databaseName}" (binding ${entry.binding})...`)
      const result = yield* runWrangler(["d1", "create", entry.databaseName])
      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          `wrangler d1 create failed for "${entry.databaseName}" (exit ${result.exitCode})`
        )
      }

      const databaseId = parseD1DatabaseIdFromOutput(result.output)
      if (!databaseId) {
        return yield* Effect.fail(
          `Could not parse database_id from wrangler d1 create output for "${entry.databaseName}"`
        )
      }

      d1Updates.push({ binding: entry.binding, databaseId })
      console.log(`    database_id: ${databaseId}`)
    }

    for (const entry of pending.kv) {
      const title = `${stateResult.stackName}-${entry.binding}`.toLowerCase()
      console.log(`  Creating KV namespace "${title}" (binding ${entry.binding})...`)
      const result = yield* runWrangler(["kv", "namespace", "create", title])
      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          `wrangler kv namespace create failed for "${title}" (exit ${result.exitCode})`
        )
      }

      const namespaceId = parseKvNamespaceIdFromOutput(result.output)
      if (!namespaceId) {
        return yield* Effect.fail(
          `Could not parse namespace id from wrangler kv namespace create output for "${title}"`
        )
      }

      kvUpdates.push({ binding: entry.binding, namespaceId })
      console.log(`    id: ${namespaceId}`)
    }

    yield* Effect.catch(
      Effect.tryPromise({
        try: () => updateWranglerConfigIds(configPath, projectDir, { d1: d1Updates, kv: kvUpdates }),
        catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause))
      }),
      (cause) => Effect.fail(cause instanceof Error ? cause.message : String(cause))
    )

    const nextState = yield* Effect.catch(
      Effect.tryPromise({
        try: () => refreshStateFromWrangler(stage, projectDir, configPath, stateResult),
        catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause))
      }),
      (cause) => Effect.fail(cause instanceof Error ? cause.message : String(cause))
    )

    yield* stateStore.saveState(stage, nextState).pipe(
      Effect.catch((error) => Effect.fail(error.message))
    )

    console.log(`  Updated ${configPath} and .monolith/state/${stage}.json`)
    return { state: nextState }
  })
