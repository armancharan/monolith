import {
  formatPlan,
  IMPORT_DIR,
  loadState,
  planState,
  stateFromImportSnapshot,
  type ImportSnapshot,
  type MonolithState
} from "@monolith/core"
import {
  hashWranglerContent,
  parseWranglerConfigText,
  toImportSnapshot,
  WranglerParseError
} from "@monolith/cloudflare"
import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { emitTypegenFromImport } from "./typegen.js"

function parseArgs(args: string[]): { stage?: string } {
  const parsed: { stage?: string } = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--stage" && args[index + 1]) {
      parsed.stage = args[index + 1]
      index += 1
    }
  }

  return parsed
}

async function readImportSnapshot(
  importPath: string,
  projectDir: string
): Promise<ImportSnapshot | undefined> {
  try {
    const text = await readFile(join(projectDir, importPath), "utf8")
    return JSON.parse(text) as ImportSnapshot
  } catch {
    return undefined
  }
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

async function resolveDesiredState(
  current: MonolithState,
  projectDir: string
): Promise<{ state: MonolithState; source: "wrangler" | "import" } | undefined> {
  if (current.wranglerConfigPath) {
    const configPath = join(projectDir, current.wranglerConfigPath)
    try {
      const content = await readFile(configPath, "utf8")
      const parsed = parseWranglerConfigText(content, configPath)
      const snapshot = toImportSnapshot(parsed, hashWranglerContent(content))
      return {
        state: stateFromImportSnapshot(snapshot, current.stage, {
          importSnapshotPath: current.importSnapshotPath,
          wranglerConfigPath: current.wranglerConfigPath
        }),
        source: "wrangler"
      }
    } catch (error) {
      if (!(error instanceof WranglerParseError)) {
        throw error
      }
    }
  }

  const importCandidates = [
    current.importSnapshotPath,
    current.importHash ? `${IMPORT_DIR}/${current.importHash}.json` : undefined,
    await latestImportSnapshot(projectDir)
  ].filter((value): value is string => Boolean(value))

  for (const importPath of importCandidates) {
    const snapshot = await readImportSnapshot(importPath, projectDir)
    if (snapshot) {
      return {
        state: stateFromImportSnapshot(snapshot, current.stage, {
          importSnapshotPath: importPath,
          wranglerConfigPath: current.wranglerConfigPath
        }),
        source: "import"
      }
    }
  }

  return undefined
}

export async function runPlan(args: string[]): Promise<number> {
  const { stage } = parseArgs(args)
  if (!stage) {
    console.error("Usage: monolith plan --stage <name>")
    return 1
  }

  const projectDir = process.cwd()
  const stateResult = await loadState(stage, projectDir)
  if (!stateResult.ok) {
    console.error(stateResult.error.message)
    console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
    return 1
  }

  const current = stateResult.value
  let desiredResult: { state: MonolithState; source: "wrangler" | "import" }
  try {
    const resolved = await resolveDesiredState(current, projectDir)
    if (!resolved) {
      console.error("Could not resolve desired state from wrangler config or import snapshot.")
      return 1
    }
    desiredResult = resolved
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    return 1
  }

  const plan = planState(current, desiredResult.state)
  plan.desiredSource = desiredResult.source
  console.log(formatPlan(stage, current, plan))

  if (current.wranglerConfigPath) {
    try {
      const configPath = join(projectDir, current.wranglerConfigPath)
      const content = await readFile(configPath, "utf8")
      const parsed = parseWranglerConfigText(content, configPath)
      await emitTypegenFromImport(projectDir, parsed)
    } catch {
      // typegen is best-effort after plan; wrangler parse errors already surfaced above
    }
  }

  return 0
}
