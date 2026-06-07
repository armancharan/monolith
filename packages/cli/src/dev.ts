import {
  formatBindingSummary,
  isPreviewStage,
  loadState,
  summarizeBindings,
  type ImportSnapshot,
  type MonolithState
} from "@monolith/core"
import {
  mergeVarsIntoWranglerConfig,
  readStageVarsFile,
  writePreviewWranglerConfig,
  writeTempWranglerConfig
} from "@monolith/cloudflare"
import { IMPORT_DIR } from "@monolith/core"
import { spawn, type ChildProcess } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { resolveDesiredState } from "./plan.js"
import { parseStageArgs, requireStage } from "./stage.js"

const DEFAULT_STAGE = "dev"
const WRANGLER_CONFIG_CANDIDATES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]
const KNOWN_FLAGS = new Set(["--stage", "--preview", "--watch"])

export interface DevArgs {
  stage: string
  watch: boolean
  wranglerArgs: string[]
}

export interface WranglerDevResult {
  exitCode: number
  signal?: NodeJS.Signals
}

export type RunWranglerDev = (
  projectDir: string,
  configPath: string,
  wranglerArgs: string[]
) => Promise<WranglerDevResult>

function parseArgs(args: string[]): DevArgs & { preview: boolean } {
  const stageParsed = parseStageArgs(args, { defaultStage: DEFAULT_STAGE })
  const stage = requireStage(
    stageParsed,
    "Usage: monolith dev [--stage <name>] [--preview] [--watch]"
  )

  const wranglerArgs: string[] = []
  let watch = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--watch") {
      watch = true
      wranglerArgs.push("--watch")
      continue
    }
    if (KNOWN_FLAGS.has(arg)) {
      if (arg === "--stage") {
        index += 1
      }
      continue
    }
    if (!arg.startsWith("-") && args[index - 1] === "--stage") {
      continue
    }
    wranglerArgs.push(arg)
  }

  return {
    stage: stage ?? "",
    preview: stageParsed.preview,
    watch,
    wranglerArgs
  }
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
      // fall through
    }
  }

  for (const candidate of WRANGLER_CONFIG_CANDIDATES) {
    try {
      await access(join(projectDir, candidate), constants.F_OK)
      return candidate
    } catch {
      // try next
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
      // try next
    }
  }

  return undefined
}

async function importSnapshotFromDesired(
  state: MonolithState,
  projectDir: string
): Promise<ImportSnapshot | undefined> {
  const desired = await resolveDesiredState(state, projectDir)
  if (!desired) {
    return undefined
  }

  const worker = desired.state.resources.find((resource) => resource.kind === "worker")
  if (!worker?.name) {
    return undefined
  }

  return {
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
}

async function applyStageVarsToConfigPath(
  configPath: string,
  stage: string,
  projectDir: string
): Promise<string> {
  const stageVars = await readStageVarsFile(stage, projectDir)
  if (!stageVars?.vars || Object.keys(stageVars.vars).length === 0) {
    return configPath
  }

  const absolutePath = join(projectDir, configPath)
  const content = await readFile(absolutePath, "utf8")
  const parsed = JSON.parse(content) as Record<string, unknown>
  const merged = mergeVarsIntoWranglerConfig(parsed, stageVars.vars)
  const varsPath = `.monolith/wrangler.${stage}.vars.jsonc`
  const varsAbsolute = join(projectDir, varsPath)

  await mkdir(join(projectDir, ".monolith"), { recursive: true })
  await writeFile(varsAbsolute, `${JSON.stringify(merged, null, 2)}\n`, "utf8")

  console.log(`  Stage vars merged from ${`.monolith/vars.${stage}.json`}`)
  return varsPath
}

export async function resolveDevConfigPath(
  stage: string,
  projectDir: string
): Promise<
  | { ok: true; configPath: string; temp: boolean; state: MonolithState }
  | { ok: false; message: string }
> {
  const stateResult = await loadState(stage, projectDir)
  if (!stateResult.ok) {
    return { ok: false, message: stateResult.error.message }
  }

  const state = stateResult.value
  const preview = isPreviewStage(stage)

  const existing = await resolveWranglerConfigPath(state, projectDir)
  if (existing) {
    let configPath = existing
    if (preview) {
      configPath = await writePreviewWranglerConfig(existing, stage, projectDir)
    }
    configPath = await applyStageVarsToConfigPath(configPath, stage, projectDir)
    return { ok: true, configPath, temp: preview || configPath.startsWith(".monolith/"), state }
  }

  const snapshot =
    (await readImportSnapshotFromState(state, projectDir)) ??
    (await importSnapshotFromDesired(state, projectDir))

  if (snapshot) {
    let previewSnapshot = snapshot
    if (preview) {
      const { previewWorkerName: suffixWorkerName } = await import("@monolith/core")
      previewSnapshot = {
        ...snapshot,
        workerName: suffixWorkerName(snapshot.workerName, stage)
      }
    }

    const stageVars = await readStageVarsFile(stage, projectDir)
    let configPath = await writeTempWranglerConfig(
      previewSnapshot,
      projectDir,
      preview ? `wrangler.${stage}.jsonc` : "wrangler.dev.jsonc"
    )

    if (stageVars?.vars) {
      const absolutePath = join(projectDir, configPath)
      const content = await readFile(absolutePath, "utf8")
      const parsed = JSON.parse(content) as Record<string, unknown>
      const merged = mergeVarsIntoWranglerConfig(parsed, stageVars.vars)
      await writeFile(absolutePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8")
    }

    return { ok: true, configPath, temp: true, state }
  }

  return {
    ok: false,
    message:
      "Could not resolve wrangler config. Run `monolith import` or add wrangler.jsonc to the project."
  }
}

export async function runWranglerDev(
  projectDir: string,
  configPath: string,
  wranglerArgs: string[] = []
): Promise<WranglerDevResult> {
  const args = ["wrangler", "dev", "--config", configPath, ...wranglerArgs]

  return new Promise((resolve) => {
    const child: ChildProcess = spawn("npx", args, {
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
  const { stage, watch, wranglerArgs } = parseArgs(args)
  if (!stage) {
    return 1
  }
  const projectDir = options?.projectDir ?? process.cwd()
  const dev = options?.runWrangler ?? runWranglerDev

  const configResult = await resolveDevConfigPath(stage, projectDir)
  if (!configResult.ok) {
    console.error(configResult.message)
    console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
    return 1
  }

  const { configPath, temp, state } = configResult
  const preview = isPreviewStage(stage)
  const bindingSummary = formatBindingSummary(
    summarizeBindings(state.resources, { previewStage: preview }),
    { previewStage: preview }
  )

  console.log(`monolith dev`)
  console.log(`  Stage: ${stage}${preview ? " (preview)" : ""}`)
  console.log(`  Config: ${configPath}${temp ? " (generated from state/import)" : ""}`)
  console.log(bindingSummary)
  if (watch) {
    console.log("  Watch: enabled (passthrough to wrangler dev --watch)")
  } else {
    console.log("  Watch: off (pass --watch to enable wrangler watch mode)")
  }

  const result = await dev(projectDir, configPath, wranglerArgs)
  return result.exitCode
}
