import {
  stateFromImportSnapshot,
  type ImportSnapshot,
  type MonolithState
} from "@monolith/core"
import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { join } from "node:path"

export const RUN_FILE = "monolith.run.ts"

/**
 * Desired-state precedence (see plan.ts resolveDesiredState):
 * 1. monolith.run.ts binding declarations merged with import/wrangler IDs
 * 2. wrangler config re-parse
 * 3. import snapshot
 */

interface ParsedBinding {
  binding: string
  databaseId?: string
  namespaceId?: string
  bucketName?: string
  queueName?: string
  id?: string
  className?: string
  scriptName?: string
}

export interface ParsedStackFile {
  stackName: string
  workerName?: string
  d1: ParsedBinding[]
  kv: ParsedBinding[]
  r2: ParsedBinding[]
  queues: ParsedBinding[]
  durableObjects: ParsedBinding[]
}

function parseOptsBlock(optsText: string | undefined): Record<string, string> {
  if (!optsText) {
    return {}
  }

  const opts: Record<string, string> = {}
  const propPattern = /(\w+)\s*:\s*["']([^"']+)["']/g
  let match = propPattern.exec(optsText)
  while (match) {
    opts[match[1]] = match[2]
    match = propPattern.exec(optsText)
  }
  return opts
}

function parseBindingCalls(
  content: string,
  method: "d1" | "kv" | "r2" | "queue" | "durableObject"
): ParsedBinding[] {
  const bindings: ParsedBinding[] = []
  const pattern = new RegExp(
    `ctx\\.${method}\\s*\\(\\s*["']([^"']+)["'](?:\\s*,\\s*\\{([^}]*)\\})?\\s*\\)`,
    "g"
  )
  let match = pattern.exec(content)
  while (match) {
    const binding = match[1]
    const opts = parseOptsBlock(match[2])
    bindings.push({
      binding,
      databaseId: opts.databaseId,
      namespaceId: opts.namespaceId,
      bucketName: opts.bucketName,
      queueName: opts.queueName,
      id: opts.id,
      className: opts.className,
      scriptName: opts.scriptName
    })
    match = pattern.exec(content)
  }
  return bindings
}

export function parseStackFileContent(content: string): ParsedStackFile | undefined {
  const stackMatch = content.match(/stack\s*\(\s*["']([^"']+)["']/)
  if (!stackMatch) {
    return undefined
  }

  const workerMatch = content.match(/ctx\.worker\s*\(\s*["']([^"']+)["']\s*\)/)

  return {
    stackName: stackMatch[1],
    workerName: workerMatch?.[1],
    d1: parseBindingCalls(content, "d1"),
    kv: parseBindingCalls(content, "kv"),
    r2: parseBindingCalls(content, "r2"),
    queues: parseBindingCalls(content, "queue"),
    durableObjects: parseBindingCalls(content, "durableObject")
  }
}

function mergeStackWithSnapshot(
  parsed: ParsedStackFile,
  base: ImportSnapshot
): ImportSnapshot {
  const workerName = parsed.workerName ?? parsed.stackName ?? base.workerName

  const d1Databases =
    parsed.d1.length > 0
      ? parsed.d1.map(({ binding, databaseId }) => {
          const fromBase = base.d1Databases?.find((entry) => entry.binding === binding)
          return {
            binding,
            databaseName: fromBase?.databaseName ?? binding.toLowerCase(),
            databaseId: fromBase?.databaseId ?? databaseId ?? ""
          }
        })
      : base.d1Databases

  const kvNamespaces =
    parsed.kv.length > 0
      ? parsed.kv.map(({ binding, namespaceId }) => {
          const fromBase = base.kvNamespaces?.find((entry) => entry.binding === binding)
          return {
            binding,
            id: fromBase?.id ?? namespaceId ?? ""
          }
        })
      : base.kvNamespaces

  const r2Buckets =
    parsed.r2.length > 0
      ? parsed.r2.map(({ binding, bucketName }) => {
          const fromBase = base.r2Buckets?.find((entry) => entry.binding === binding)
          return {
            binding,
            bucketName: fromBase?.bucketName ?? bucketName
          }
        })
      : base.r2Buckets

  const queues =
    parsed.queues.length > 0
      ? parsed.queues.map(({ binding, queueName, id }) => {
          const fromBase = base.queues?.find((entry) => entry.binding === binding)
          return {
            binding,
            queueName: fromBase?.queueName ?? queueName,
            id: fromBase?.id ?? id
          }
        })
      : base.queues

  const durableObjects =
    parsed.durableObjects.length > 0
      ? parsed.durableObjects.map(({ binding, className, scriptName }) => {
          const fromBase = base.durableObjects?.find((entry) => entry.binding === binding)
          return {
            binding,
            className: fromBase?.className ?? className ?? binding,
            scriptName: fromBase?.scriptName ?? scriptName
          }
        })
      : base.durableObjects

  return {
    ...base,
    workerName,
    d1Databases,
    kvNamespaces,
    r2Buckets,
    queues,
    durableObjects
  }
}

export async function stackFileExists(projectDir: string): Promise<boolean> {
  try {
    await access(join(projectDir, RUN_FILE), constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function loadDesiredFromStackFile(
  projectDir: string,
  current: MonolithState,
  baseSnapshot: ImportSnapshot
): Promise<MonolithState | undefined> {
  let content: string
  try {
    content = await readFile(join(projectDir, RUN_FILE), "utf8")
  } catch {
    return undefined
  }

  const parsed = parseStackFileContent(content)
  if (!parsed) {
    return undefined
  }

  const merged = mergeStackWithSnapshot(parsed, baseSnapshot)
  return stateFromImportSnapshot(merged, current.stage, {
    importSnapshotPath: current.importSnapshotPath,
    wranglerConfigPath: current.wranglerConfigPath
  })
}
