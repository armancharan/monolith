import {
  formatPlan,
  IMPORT_DIR,
  loadState,
  planState,
  stateFromImportSnapshot,
  type ImportSnapshot,
  type MonolithState,
  type PlanResult
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
import { loadDesiredFromStackFile, stackFileExists } from "./stack-file.js"

export type DesiredSource = "stack" | "wrangler" | "import"

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

async function snapshotFromWrangler(
  current: MonolithState,
  projectDir: string
): Promise<ImportSnapshot | undefined> {
  if (!current.wranglerConfigPath) {
    return undefined
  }

  const configPath = join(projectDir, current.wranglerConfigPath)
  try {
    const content = await readFile(configPath, "utf8")
    const parsed = parseWranglerConfigText(content, configPath)
    return toImportSnapshot(parsed, hashWranglerContent(content))
  } catch (error) {
    if (!(error instanceof WranglerParseError)) {
      throw error
    }
    return undefined
  }
}

async function snapshotFromImport(
  current: MonolithState,
  projectDir: string
): Promise<{ snapshot: ImportSnapshot; path: string } | undefined> {
  const importCandidates = [
    current.importSnapshotPath,
    current.importHash ? `${IMPORT_DIR}/${current.importHash}.json` : undefined,
    await latestImportSnapshot(projectDir)
  ].filter((value): value is string => Boolean(value))

  for (const importPath of importCandidates) {
    const snapshot = await readImportSnapshot(importPath, projectDir)
    if (snapshot) {
      return { snapshot, path: importPath }
    }
  }

  return undefined
}

/**
 * Resolve desired state for plan/deploy.
 *
 * Precedence:
 * 1. monolith.run.ts merged with wrangler/import snapshot (when run file + base snapshot exist)
 * 2. wrangler config re-parse
 * 3. import snapshot
 */
export async function resolveDesiredState(
  current: MonolithState,
  projectDir: string
): Promise<{ state: MonolithState; source: DesiredSource } | undefined> {
  const wranglerSnapshot = await snapshotFromWrangler(current, projectDir)
  const importResult = await snapshotFromImport(current, projectDir)
  const baseSnapshot = wranglerSnapshot ?? importResult?.snapshot

  if (baseSnapshot && (await stackFileExists(projectDir))) {
    const stackState = await loadDesiredFromStackFile(projectDir, current, baseSnapshot)
    if (stackState) {
      return { state: stackState, source: "stack" }
    }
  }

  if (wranglerSnapshot && current.wranglerConfigPath) {
    return {
      state: stateFromImportSnapshot(wranglerSnapshot, current.stage, {
        importSnapshotPath: current.importSnapshotPath,
        wranglerConfigPath: current.wranglerConfigPath
      }),
      source: "wrangler"
    }
  }

  if (importResult) {
    return {
      state: stateFromImportSnapshot(importResult.snapshot, current.stage, {
        importSnapshotPath: importResult.path,
        wranglerConfigPath: current.wranglerConfigPath
      }),
      source: "import"
    }
  }

  return undefined
}

export interface EvaluatePlanResult {
  current: MonolithState
  plan: PlanResult
}

export async function evaluatePlan(
  stage: string,
  projectDir: string
): Promise<
  | { ok: true; value: EvaluatePlanResult }
  | { ok: false; exitCode: number; message: string }
> {
  const stateResult = await loadState(stage, projectDir)
  if (!stateResult.ok) {
    return {
      ok: false,
      exitCode: 1,
      message: stateResult.error.message
    }
  }

  const current = stateResult.value
  let desiredResult: { state: MonolithState; source: DesiredSource }
  try {
    const resolved = await resolveDesiredState(current, projectDir)
    if (!resolved) {
      return {
        ok: false,
        exitCode: 1,
        message: "Could not resolve desired state from monolith.run.ts, wrangler config, or import snapshot."
      }
    }
    desiredResult = resolved
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, exitCode: 1, message }
  }

  const plan = planState(current, desiredResult.state)
  plan.desiredSource = desiredResult.source
  return { ok: true, value: { current, plan } }
}

export async function runPlan(
  args: string[],
  options?: { projectDir?: string }
): Promise<number> {
  const { stage } = parseArgs(args)
  if (!stage) {
    console.error("Usage: monolith plan --stage <name>")
    return 1
  }

  const projectDir = options?.projectDir ?? process.cwd()
  const evaluated = await evaluatePlan(stage, projectDir)
  if (!evaluated.ok) {
    console.error(evaluated.message)
    if (evaluated.message.includes("State file not found")) {
      console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
    }
    return evaluated.exitCode
  }

  const { current, plan } = evaluated.value
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
