import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { STATE_DIR, statePath } from "./paths.js"

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export class StateError extends Error {
  readonly _tag = "StateError"

  constructor(message: string) {
    super(message)
    this.name = "StateError"
  }
}

export interface StateResource {
  id: string
  kind: string
  binding?: string
  name?: string
  databaseId?: string
  namespaceId?: string
  bucketName?: string
  className?: string
  scriptName?: string
}

export interface ImportSnapshot {
  workerName: string
  contentHash: string
  d1Databases?: Array<{
    binding: string
    databaseName: string
    databaseId: string
  }>
  kvNamespaces?: Array<{
    binding: string
    id: string
  }>
  r2Buckets?: Array<{
    binding: string
    bucketName?: string
  }>
  queues?: Array<{
    binding: string
    queueName?: string
    id?: string
  }>
  durableObjects?: Array<{
    binding: string
    className: string
    scriptName?: string
  }>
}

export interface MonolithState {
  stackName: string
  stage: string
  resources: StateResource[]
  updatedAt: string
  importHash?: string
  importSnapshotPath?: string
  wranglerConfigPath?: string
  /** ISO timestamp of last successful deploy via monolith deploy. */
  deployedAt?: string
  /** Worker URL parsed from wrangler deploy output, when available. */
  workerUrl?: string
}

export function resourcesFromImport(snapshot: ImportSnapshot): StateResource[] {
  const resources: StateResource[] = [
    {
      id: `worker:${snapshot.workerName}`,
      kind: "worker",
      name: snapshot.workerName
    }
  ]

  for (const entry of snapshot.d1Databases ?? []) {
    resources.push({
      id: `d1:${entry.binding}`,
      kind: "d1",
      binding: entry.binding,
      name: entry.databaseName,
      databaseId: entry.databaseId
    })
  }

  for (const entry of snapshot.kvNamespaces ?? []) {
    resources.push({
      id: `kv:${entry.binding}`,
      kind: "kv",
      binding: entry.binding,
      namespaceId: entry.id
    })
  }

  for (const entry of snapshot.r2Buckets ?? []) {
    resources.push({
      id: `r2:${entry.binding}`,
      kind: "r2",
      binding: entry.binding,
      bucketName: entry.bucketName
    })
  }

  for (const entry of snapshot.queues ?? []) {
    resources.push({
      id: `queue:${entry.binding}`,
      kind: "queue",
      binding: entry.binding,
      name: entry.queueName ?? entry.id
    })
  }

  for (const entry of snapshot.durableObjects ?? []) {
    resources.push({
      id: `durable_object:${entry.binding}`,
      kind: "durable_object",
      binding: entry.binding,
      name: entry.className,
      className: entry.className,
      scriptName: entry.scriptName
    })
  }

  return resources
}

export function stateFromImportSnapshot(
  snapshot: ImportSnapshot,
  stage: string,
  options?: {
    importSnapshotPath?: string
    wranglerConfigPath?: string
    updatedAt?: string
  }
): MonolithState {
  return {
    stackName: snapshot.workerName,
    stage,
    resources: resourcesFromImport(snapshot),
    updatedAt: options?.updatedAt ?? new Date().toISOString(),
    importHash: snapshot.contentHash,
    importSnapshotPath: options?.importSnapshotPath,
    wranglerConfigPath: options?.wranglerConfigPath
  }
}

export function stateFilePath(stage: string, projectDir = process.cwd()): string {
  return join(projectDir, statePath(stage))
}

export async function loadState(
  stage: string,
  projectDir = process.cwd()
): Promise<Result<MonolithState, StateError>> {
  const filePath = stateFilePath(stage, projectDir)

  let text: string
  try {
    text = await readFile(filePath, "utf8")
  } catch {
    return err(new StateError(`State file not found: ${statePath(stage)}`))
  }

  try {
    const parsed = JSON.parse(text) as MonolithState
    if (!parsed.stackName || !parsed.stage || !Array.isArray(parsed.resources)) {
      return err(new StateError(`Invalid state file: ${statePath(stage)}`))
    }
    return ok(parsed)
  } catch {
    return err(new StateError(`Could not parse state JSON: ${statePath(stage)}`))
  }
}

export async function saveState(
  stage: string,
  data: MonolithState,
  projectDir = process.cwd()
): Promise<Result<string, StateError>> {
  const filePath = stateFilePath(stage, projectDir)
  const dirPath = join(projectDir, STATE_DIR)

  try {
    await mkdir(dirPath, { recursive: true })
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
    return ok(statePath(stage))
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return err(new StateError(`Could not write state file: ${message}`))
  }
}

export async function initStateFromImport(
  importPath: string,
  stage: string,
  projectDir = process.cwd(),
  options?: { wranglerConfigPath?: string }
): Promise<Result<MonolithState, StateError>> {
  const resolvedImportPath = join(projectDir, importPath)

  let text: string
  try {
    text = await readFile(resolvedImportPath, "utf8")
  } catch {
    return err(new StateError(`Import snapshot not found: ${importPath}`))
  }

  let snapshot: ImportSnapshot
  try {
    snapshot = JSON.parse(text) as ImportSnapshot
  } catch {
    return err(new StateError(`Could not parse import snapshot: ${importPath}`))
  }

  if (!snapshot.workerName || !snapshot.contentHash) {
    return err(new StateError(`Import snapshot missing workerName or contentHash: ${importPath}`))
  }

  const state = stateFromImportSnapshot(snapshot, stage, {
    importSnapshotPath: importPath,
    wranglerConfigPath: options?.wranglerConfigPath
  })

  const saveResult = await saveState(stage, state, projectDir)
  if (!saveResult.ok) {
    return saveResult
  }

  return ok(state)
}
