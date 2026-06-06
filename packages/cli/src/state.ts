import { IMPORT_DIR, initStateFromImport } from "@monolith/core"
import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"

function parseArgs(args: string[]): {
  stage?: string
  from?: string
} {
  const parsed: { stage?: string; from?: string } = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--stage" && args[index + 1]) {
      parsed.stage = args[index + 1]
      index += 1
      continue
    }
    if (arg === "--from" && args[index + 1]) {
      parsed.from = args[index + 1]
      index += 1
    }
  }

  return parsed
}

async function latestImportSnapshot(projectDir: string): Promise<string | undefined> {
  const importDir = join(projectDir, IMPORT_DIR)
  let entries: string[]
  try {
    entries = await readdir(importDir)
  } catch {
    return undefined
  }

  const jsonFiles = entries.filter((entry) => entry.endsWith(".json"))
  if (jsonFiles.length === 0) {
    return undefined
  }

  let latestPath: string | undefined
  let latestMtime = 0

  for (const file of jsonFiles) {
    const filePath = join(importDir, file)
    const fileStat = await stat(filePath)
    if (fileStat.mtimeMs >= latestMtime) {
      latestMtime = fileStat.mtimeMs
      latestPath = `${IMPORT_DIR}/${file}`
    }
  }

  return latestPath
}

export async function runStateInit(args: string[]): Promise<number> {
  const { stage, from } = parseArgs(args)
  if (!stage) {
    console.error("Usage: monolith state init --stage <name> [--from .monolith/import/<hash>.json]")
    return 1
  }

  const projectDir = process.cwd()
  const importPath = from ?? (await latestImportSnapshot(projectDir))
  if (!importPath) {
    console.error("No import snapshot found. Run `monolith import` first or pass --from.")
    return 1
  }

  const result = await initStateFromImport(importPath, stage, projectDir)
  if (!result.ok) {
    console.error(result.error.message)
    return 1
  }

  const state = result.value
  console.log(`Initialized state for stage "${stage}"`)
  console.log(`  Stack: ${state.stackName}`)
  console.log(`  Resources: ${state.resources.length}`)
  console.log(`  Import hash: ${state.importHash ?? "(none)"}`)
  console.log(`  Wrote .monolith/state/${stage}.json`)

  return 0
}
