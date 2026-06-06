import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename, extname } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { parse as parseToml } from "smol-toml"
import type {
  D1Database,
  KvNamespace,
  R2Bucket,
  WorkerResource
} from "./stack.js"

export interface WranglerD1Database {
  binding: string
  databaseName: string
  databaseId: string
}

export interface WranglerKvNamespace {
  binding: string
  id: string
}

export interface WranglerQueue {
  binding: string
  queueName?: string
  id?: string
}

export interface WranglerR2Bucket {
  binding: string
  bucketName?: string
}

export interface WranglerImportResult {
  sourcePath: string
  configBasename: string
  workerName: string
  main: string
  compatibilityDate?: string
  d1Databases: WranglerD1Database[]
  kvNamespaces: WranglerKvNamespace[]
  queues: WranglerQueue[]
  r2Buckets: WranglerR2Bucket[]
}

export interface WranglerImportSnapshot extends Omit<WranglerImportResult, "sourcePath"> {
  importedAt: string
  contentHash: string
}

export interface WranglerStackResources {
  worker: WorkerResource
  d1: D1Database[]
  kv: KvNamespace[]
  r2: R2Bucket[]
}

interface RawWranglerConfig {
  name?: string
  main?: string
  compatibility_date?: string
  d1_databases?: Array<{
    binding?: string
    database_name?: string
    database_id?: string
  }>
  kv_namespaces?: Array<{
    binding?: string
    id?: string
  }>
  queues?: {
    producers?: Array<{
      binding?: string
      queue?: string
    }>
    consumers?: Array<{
      queue?: string
      max_batch_size?: number
    }>
  } | Array<{
    binding?: string
    queue?: string
    id?: string
  }>
  r2_buckets?: Array<{
    binding?: string
    bucket_name?: string
  }>
}

export class WranglerParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WranglerParseError"
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WranglerParseError(`Missing or invalid wrangler field: ${field}`)
  }
  return value
}

function parseWranglerJson(text: string, sourceLabel: string): RawWranglerConfig {
  const errors: Parameters<typeof parseJsonc>[1] = []
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    const first = errors[0]
    throw new WranglerParseError(
      `Failed to parse ${sourceLabel} at offset ${first.offset}: ${first.error}`
    )
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WranglerParseError(`Expected wrangler config object in ${sourceLabel}`)
  }
  return parsed as RawWranglerConfig
}

function parseWranglerToml(text: string, sourceLabel: string): RawWranglerConfig {
  try {
    const parsed = parseToml(text)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new WranglerParseError(`Expected wrangler config object in ${sourceLabel}`)
    }
    return parsed as RawWranglerConfig
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new WranglerParseError(`Failed to parse ${sourceLabel}: ${message}`)
  }
}

function normalizeQueues(raw: RawWranglerConfig["queues"]): WranglerQueue[] {
  if (!raw) {
    return []
  }

  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => {
      const binding = entry.binding?.trim()
      if (!binding) {
        return []
      }
      return [{
        binding,
        queueName: entry.queue?.trim(),
        id: entry.id?.trim()
      }]
    })
  }

  const producers = raw.producers ?? []
  return producers.flatMap((entry) => {
    const binding = entry.binding?.trim()
    if (!binding) {
      return []
    }
    return [{
      binding,
      queueName: entry.queue?.trim()
    }]
  })
}

function normalizeConfig(
  raw: RawWranglerConfig,
  sourcePath: string,
  configBasename: string
): WranglerImportResult {
  const workerName = requireString(raw.name, "name")
  const main = requireString(raw.main, "main")

  const d1Databases = (raw.d1_databases ?? []).flatMap((entry) => {
    const binding = entry.binding?.trim()
    const databaseName = entry.database_name?.trim()
    const databaseId = entry.database_id?.trim()
    if (!binding || !databaseName || !databaseId) {
      return []
    }
    return [{ binding, databaseName, databaseId }]
  })

  const kvNamespaces = (raw.kv_namespaces ?? []).flatMap((entry) => {
    const binding = entry.binding?.trim()
    const id = entry.id?.trim()
    if (!binding || !id) {
      return []
    }
    return [{ binding, id }]
  })

  const r2Buckets = (raw.r2_buckets ?? []).flatMap((entry) => {
    const binding = entry.binding?.trim()
    if (!binding) {
      return []
    }
    return [{
      binding,
      bucketName: entry.bucket_name?.trim()
    }]
  })

  return {
    sourcePath,
    configBasename,
    workerName,
    main,
    compatibilityDate: raw.compatibility_date?.trim(),
    d1Databases,
    kvNamespaces,
    queues: normalizeQueues(raw.queues),
    r2Buckets
  }
}

export function hashWranglerContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

export function parseWranglerConfigText(
  content: string,
  sourcePath: string
): WranglerImportResult {
  const configBasename = basename(sourcePath)
  const ext = extname(sourcePath).toLowerCase()

  const raw =
    ext === ".toml"
      ? parseWranglerToml(content, configBasename)
      : parseWranglerJson(content, configBasename)

  return normalizeConfig(raw, sourcePath, configBasename)
}

export function parseWranglerConfigFile(sourcePath: string): WranglerImportResult {
  const content = readFileSync(sourcePath, "utf8")
  return parseWranglerConfigText(content, sourcePath)
}

export function toImportSnapshot(
  result: WranglerImportResult,
  contentHash: string,
  importedAt = new Date().toISOString()
): WranglerImportSnapshot {
  const { sourcePath: _sourcePath, ...rest } = result
  return {
    ...rest,
    importedAt,
    contentHash
  }
}

export function toStackResources(result: WranglerImportResult): WranglerStackResources {
  return {
    worker: { type: "worker", name: result.workerName },
    d1: result.d1Databases.map((entry) => ({
      type: "d1",
      name: entry.binding,
      databaseId: entry.databaseId
    })),
    kv: result.kvNamespaces.map((entry) => ({
      type: "kv",
      name: entry.binding,
      namespaceId: entry.id
    })),
    r2: result.r2Buckets.map((entry) => ({
      type: "r2",
      name: entry.binding,
      bucketName: entry.bucketName
    }))
  }
}

export function formatImportSummary(result: WranglerImportResult): string {
  const lines = [
    `Imported wrangler config: ${result.configBasename}`,
    `  Worker: ${result.workerName} (${result.main})`
  ]

  if (result.compatibilityDate) {
    lines.push(`  Compatibility date: ${result.compatibilityDate}`)
  }

  for (const entry of result.d1Databases) {
    lines.push(
      `  D1: ${entry.binding} → ${entry.databaseName} (${entry.databaseId})`
    )
  }

  for (const entry of result.kvNamespaces) {
    lines.push(`  KV: ${entry.binding} → ${entry.id}`)
  }

  for (const entry of result.r2Buckets) {
    const target = entry.bucketName ?? entry.binding
    lines.push(`  R2: ${entry.binding} → ${target}`)
  }

  for (const entry of result.queues) {
    const target = entry.queueName ?? entry.id ?? "(unnamed queue)"
    lines.push(`  Queue: ${entry.binding} → ${target}`)
  }

  return lines.join("\n")
}

export function generateMonolithRunTs(result: WranglerImportResult): string {
  const lines = [
    'import { stack } from "@monolith/cloudflare"',
    "",
    `export default stack(${JSON.stringify(result.workerName)}, async (ctx) => {`,
    `  ctx.worker(${JSON.stringify(result.workerName)})`
  ]

  for (const entry of result.d1Databases) {
    lines.push(
      `  ctx.d1(${JSON.stringify(entry.binding)}, { databaseId: ${JSON.stringify(entry.databaseId)} })`
    )
  }

  for (const entry of result.kvNamespaces) {
    lines.push(
      `  ctx.kv(${JSON.stringify(entry.binding)}, { namespaceId: ${JSON.stringify(entry.id)} })`
    )
  }

  for (const entry of result.r2Buckets) {
    if (entry.bucketName) {
      lines.push(
        `  ctx.r2(${JSON.stringify(entry.binding)}, { bucketName: ${JSON.stringify(entry.bucketName)} })`
      )
    } else {
      lines.push(`  ctx.r2(${JSON.stringify(entry.binding)})`)
    }
  }

  for (const entry of result.queues) {
    lines.push(
      `  // Queue binding ${entry.binding} — ctx.queue() lands in C4`
    )
  }

  lines.push("})")
  lines.push("")
  return lines.join("\n")
}
