import { join } from "node:path"
import { statePath } from "./paths.js"

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
