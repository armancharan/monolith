import { IMPORT_DIR, loadState, type ImportSnapshot, type MonolithState } from "@monolith/core"
import { writeTempWranglerConfig } from "@monolith/cloudflare"
import { spawn, type ChildProcess } from "node:child_process"
import { constants } from "node:fs"
import { access, readFile } from "node:fs/promises"
import { join } from "node:path"
import { resolveDesiredState } from "./plan.js"

const DEFAULT_STAGE = "dev"
const WRANGLER_CONFIG_CANDIDATES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]

export interface DevArgs {
  stage: string
}

export interface WranglerDevResult {
  exitCode: number
  signal?: NodeJS.Signals
}

export type RunWranglerDev = (
  projectDir: string,
  configPath: string
) => Promise<WranglerDevResult>

function parseArgs(args: string[]): DevArgs {
  const parsed: DevArgs = { stage: DEFAULT_STAGE }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--stage" && args[index + 1]) {
      parsed.stage = args[index + 1]
      index += 1
    }
  }

  return parsed
}

async function resolveWranglerConfigPath(
  state: MonolithState,
  projectDir: string
): Promise<string | undefined> {
  if (state.wranglerConfigPath) {
    try {
      await access(join(projectDir, state.wranglerConfigPath), constants.F_OK)
      return state.wranglerConfigPath
    } catch {
      // fall through to candidates / temp config
    }
  }

  for (const candidate of WRANGLER_CONFIG_CANDIDATES) {
    try {
      await access(join(projectDir, candidate), constants.F_OK)
      return candidate
    } catch {
      // try next candidate
    }
  }

  return undefined
}

async function readImportSnapshotFromState(
  state: MonolithState,
  projectDir: string
): Promise<ImportSnapshot | undefined> {
  const candidates = [
    state.importSnapshotPath,
    state.importHash ? `${IMPORT_DIR}/${state.importHash}.json` : undefined
  ].filter((value): value is string => Boolean(value))

  for (const importPath of candidates) {
    try {
      const text = await readFile(join(projectDir, importPath), "utf8")
      return JSON.parse(text) as ImportSnapshot
    } catch {
      // try next candidate
    }
  }

  return undefined
}

export async function resolveDevConfigPath(
  stage: string,
  projectDir: string
): Promise<
  | { ok: true; configPath: string; temp: boolean }
  | { ok: false; message: string }
> {
  const stateResult = await loadState(stage, projectDir)
  if (!stateResult.ok) {
    return { ok: false, message: stateResult.error.message }
  }

  const state = stateResult.value
  const existing = await resolveWranglerConfigPath(state, projectDir)
  if (existing) {
    return { ok: true, configPath: existing, temp: false }
  }

  const desired = await resolveDesiredState(state, projectDir)
  const snapshot = await readImportSnapshotFromState(state, projectDir)
  if (!snapshot && desired) {
    const worker = desired.state.resources.find((resource) => resource.kind === "worker")
    if (worker?.name) {
      const fallback: ImportSnapshot = {
        workerName: worker.name,
        contentHash: state.importHash ?? "dev-temp",
        d1Databases: desired.state.resources
          .filter((resource) => resource.kind === "d1")
          .map((resource) => ({
            binding: resource.binding ?? resource.id,
            databaseName: resource.name ?? resource.binding ?? resource.id,
            databaseId: resource.databaseId ?? ""
          })),
        kvNamespaces: desired.state.resources
          .filter((resource) => resource.kind === "kv")
          .map((resource) => ({
            binding: resource.binding ?? resource.id,
            id: resource.namespaceId ?? ""
          })),
        r2Buckets: desired.state.resources
          .filter((resource) => resource.kind === "r2")
          .map((resource) => ({
            binding: resource.binding ?? resource.id,
            bucketName: resource.bucketName
          })),
        queues: desired.state.resources
          .filter((resource) => resource.kind === "queue")
          .map((resource) => ({
            binding: resource.binding ?? resource.id,
            queueName: resource.name
          })),
        durableObjects: desired.state.resources
          .filter((resource) => resource.kind === "durable_object")
          .map((resource) => ({
            binding: resource.binding ?? resource.id,
            className: resource.className ?? resource.name ?? resource.binding ?? resource.id,
            scriptName: resource.scriptName
          }))
      }
      const configPath = await writeTempWranglerConfig(fallback, projectDir)
      return { ok: true, configPath, temp: true }
    }
  }

  if (snapshot) {
    const configPath = await writeTempWranglerConfig(snapshot, projectDir)
    return { ok: true, configPath, temp: true }
  }

  return {
    ok: false,
    message:
      "Could not resolve wrangler config. Run `monolith import` or add wrangler.jsonc to the project."
  }
}

export async function runWranglerDev(
  projectDir: string,
  configPath: string
): Promise<WranglerDevResult> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn("npx", ["wrangler", "dev", "--config", configPath], {
      cwd: projectDir,
      env: process.env,
      stdio: "inherit"
    })

    let sigintHandler: (() => void) | undefined

    sigintHandler = () => {
      if (!child.killed) {
        child.kill("SIGINT")
      }
    }
    process.on("SIGINT", sigintHandler)

    child.on("close", (code, signal) => {
      if (sigintHandler) {
        process.off("SIGINT", sigintHandler)
      }
      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        signal: signal ?? undefined
      })
    })

    child.on("error", (error) => {
      if (sigintHandler) {
        process.off("SIGINT", sigintHandler)
      }
      console.error(error.message)
      resolve({ exitCode: 1 })
    })
  })
}

export async function runDev(
  args: string[],
  options?: { runWrangler?: RunWranglerDev; projectDir?: string }
): Promise<number> {
  const { stage } = parseArgs(args)
  const projectDir = options?.projectDir ?? process.cwd()
  const dev = options?.runWrangler ?? runWranglerDev

  const configResult = await resolveDevConfigPath(stage, projectDir)
  if (!configResult.ok) {
    console.error(configResult.message)
    console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
    return 1
  }

  const { configPath, temp } = configResult
  console.log(`Starting wrangler dev for stage "${stage}"...`)
  console.log(`  Config: ${configPath}${temp ? " (generated from state/import)" : ""}`)

  const result = await dev(projectDir, configPath)
  return result.exitCode
}
