import type { ImportSnapshot } from "@monolith/core"
import { isPreviewStage, MONOLITH_DIR, previewWorkerName } from "@monolith/core"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseWranglerConfigText, toImportSnapshot, hashWranglerContent, type WranglerImportSnapshot } from "./wrangler-import.js"

type SnapshotLike = ImportSnapshot | WranglerImportSnapshot

const DEFAULT_MAIN = "src/index.ts"
const DEFAULT_COMPATIBILITY_DATE = "2025-03-01"

export function snapshotToWranglerConfigObject(snapshot: SnapshotLike): Record<string, unknown> {
  const config: Record<string, unknown> = {
    name: snapshot.workerName,
    main: "main" in snapshot && snapshot.main ? snapshot.main : DEFAULT_MAIN,
    compatibility_date:
      "compatibilityDate" in snapshot && snapshot.compatibilityDate
        ? snapshot.compatibilityDate
        : DEFAULT_COMPATIBILITY_DATE
  }

  if (snapshot.d1Databases && snapshot.d1Databases.length > 0) {
    config.d1_databases = snapshot.d1Databases.map((entry) => ({
      binding: entry.binding,
      database_name: entry.databaseName,
      database_id: entry.databaseId
    }))
  }

  if (snapshot.kvNamespaces && snapshot.kvNamespaces.length > 0) {
    config.kv_namespaces = snapshot.kvNamespaces.map((entry) => ({
      binding: entry.binding,
      id: entry.id
    }))
  }

  if (snapshot.r2Buckets && snapshot.r2Buckets.length > 0) {
    config.r2_buckets = snapshot.r2Buckets.map((entry) => ({
      binding: entry.binding,
      ...(entry.bucketName ? { bucket_name: entry.bucketName } : {})
    }))
  }

  if (snapshot.queues && snapshot.queues.length > 0) {
    config.queues = {
      producers: snapshot.queues.map((entry) => ({
        binding: entry.binding,
        queue: entry.queueName ?? entry.id
      }))
    }
  }

  if (snapshot.durableObjects && snapshot.durableObjects.length > 0) {
    config.durable_objects = {
      bindings: snapshot.durableObjects.map((entry) => ({
        name: entry.binding,
        class_name: entry.className,
        ...(entry.scriptName ? { script_name: entry.scriptName } : {})
      }))
    }
  }

  return config
}

export async function writeTempWranglerConfig(
  snapshot: SnapshotLike,
  projectDir: string,
  filename = "wrangler.dev.jsonc"
): Promise<string> {
  const relativePath = `${MONOLITH_DIR}/${filename}`
  const absolutePath = join(projectDir, relativePath)
  const config = snapshotToWranglerConfigObject(snapshot)

  await mkdir(join(projectDir, MONOLITH_DIR), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(config, null, 2)}\n`, "utf8")

  return relativePath
}

export async function writePreviewWranglerConfig(
  baseConfigPath: string,
  stage: string,
  projectDir: string
): Promise<string> {
  if (!isPreviewStage(stage)) {
    return baseConfigPath
  }

  const absolutePath = join(projectDir, baseConfigPath)
  const content = await readFile(absolutePath, "utf8")
  const parsed = parseWranglerConfigText(content, baseConfigPath)
  const snapshot = toImportSnapshot(parsed, hashWranglerContent(content))
  const previewSnapshot: WranglerImportSnapshot = {
    ...snapshot,
    workerName: previewWorkerName(snapshot.workerName, stage)
  }

  const filename = `wrangler.${stage}.jsonc`
  return writeTempWranglerConfig(previewSnapshot, projectDir, filename)
}
