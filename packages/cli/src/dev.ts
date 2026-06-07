import {
  formatBindingSummary,
  isPreviewStage,
  previewWorkerName,
  StateStore,
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
import { Effect } from "effect"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tryPromiseOr } from "./effect-helpers.js"
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

const resolveWranglerConfigPath = (
  state: MonolithState,
  projectDir: string
): Effect.Effect<string | undefined, never> =>
  Effect.gen(function* () {
    if (state.wranglerConfigPath) {
      const exists = yield* tryPromiseOr(async () => {
        await access(join(projectDir, state.wranglerConfigPath!), constants.F_OK)
        return true
      }, false)
      if (exists) {
        return state.wranglerConfigPath
      }
    }

    for (const candidate of WRANGLER_CONFIG_CANDIDATES) {
      const exists = yield* tryPromiseOr(async () => {
        await access(join(projectDir, candidate), constants.F_OK)
        return true
      }, false)
      if (exists) {
        return candidate
      }
    }

    return undefined
  })

const readImportSnapshotFromState = (
  state: MonolithState,
  projectDir: string
): Effect.Effect<ImportSnapshot | undefined, never> =>
  Effect.gen(function* () {
    const candidates = [
      state.importSnapshotPath,
      state.importHash ? `${IMPORT_DIR}/${state.importHash}.json` : undefined
    ].filter((value): value is string => Boolean(value))

    for (const importPath of candidates) {
      const snapshot = yield* tryPromiseOr(async () => {
        const text = await readFile(join(projectDir, importPath), "utf8")
        return JSON.parse(text) as ImportSnapshot
      }, undefined)
      if (snapshot) {
        return snapshot
      }
    }

    return undefined
  })

const importSnapshotFromDesired = (
  state: MonolithState,
  projectDir: string
): Effect.Effect<ImportSnapshot | undefined, never> =>
  Effect.gen(function* () {
    const desired = yield* resolveDesiredState(state, projectDir).pipe(
      Effect.catch(() => Effect.succeed(undefined))
    )
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
  })

const applyStageVarsToConfigPath = (
  configPath: string,
  stage: string,
  projectDir: string
): Effect.Effect<string, never> =>
  Effect.gen(function* () {
    const stageVars = yield* tryPromiseOr(() => readStageVarsFile(stage, projectDir), undefined)
    if (!stageVars?.vars || Object.keys(stageVars.vars).length === 0) {
      return configPath
    }

    const absolutePath = join(projectDir, configPath)
    const content = yield* tryPromiseOr(() => readFile(absolutePath, "utf8"), "")
    const parsed = JSON.parse(content) as Record<string, unknown>
    const merged = mergeVarsIntoWranglerConfig(parsed, stageVars.vars)
    const varsPath = `.monolith/wrangler.${stage}.vars.jsonc`
    const varsAbsolute = join(projectDir, varsPath)

    yield* tryPromiseOr(async () => {
      await mkdir(join(projectDir, ".monolith"), { recursive: true })
      await writeFile(varsAbsolute, `${JSON.stringify(merged, null, 2)}\n`, "utf8")
    }, undefined)

    console.log(`  Stage vars merged from ${`.monolith/vars.${stage}.json`}`)
    return varsPath
  })

export type DevConfigResult =
  | { ok: true; configPath: string; temp: boolean; state: MonolithState }
  | { ok: false; message: string }

export const resolveDevConfigPath = (
  stage: string,
  projectDir: string
): Effect.Effect<DevConfigResult, never, StateStore> =>
  Effect.gen(function* () {
    const stateStore = yield* StateStore
    const state = yield* stateStore.loadState(stage).pipe(
      Effect.map((value) => ({ ok: true as const, value })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, message: error.message }))
    )

    if (!state.ok) {
      return { ok: false, message: state.message }
    }

    const loaded = state.value
    const preview = isPreviewStage(stage)

    const existing = yield* resolveWranglerConfigPath(loaded, projectDir)
    if (existing) {
      let configPath = existing
      if (preview) {
        configPath = yield* tryPromiseOr(
          () => writePreviewWranglerConfig(existing, stage, projectDir),
          existing
        )
      }
      configPath = yield* applyStageVarsToConfigPath(configPath, stage, projectDir)
      return {
        ok: true,
        configPath,
        temp: preview || configPath.startsWith(".monolith/"),
        state: loaded
      }
    }

    const snapshot =
      (yield* readImportSnapshotFromState(loaded, projectDir)) ??
      (yield* importSnapshotFromDesired(loaded, projectDir))

    if (snapshot) {
      let previewSnapshot = snapshot
      if (preview) {
        previewSnapshot = {
          ...snapshot,
          workerName: previewWorkerName(snapshot.workerName, stage)
        }
      }

      const stageVars = yield* tryPromiseOr(() => readStageVarsFile(stage, projectDir), undefined)
      let configPath = yield* tryPromiseOr(
        () =>
          writeTempWranglerConfig(
            previewSnapshot,
            projectDir,
            preview ? `wrangler.${stage}.jsonc` : "wrangler.dev.jsonc"
          ),
        ""
      )

      if (stageVars?.vars && configPath) {
        const absolutePath = join(projectDir, configPath)
        const content = yield* tryPromiseOr(() => readFile(absolutePath, "utf8"), "")
        const parsed = JSON.parse(content) as Record<string, unknown>
        const merged = mergeVarsIntoWranglerConfig(parsed, stageVars.vars)
        yield* tryPromiseOr(
          () => writeFile(absolutePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8"),
          undefined
        )
      }

      return { ok: true, configPath, temp: true, state: loaded }
    }

    return {
      ok: false,
      message:
        "Could not resolve wrangler config. Run `monolith import` or add wrangler.jsonc to the project."
    }
  })

export const runWranglerDev = (
  projectDir: string,
  configPath: string,
  wranglerArgs: string[] = []
): Effect.Effect<WranglerDevResult, never> =>
  tryPromiseOr(
    () =>
      new Promise<WranglerDevResult>((resolve) => {
        const args = ["wrangler", "dev", "--config", configPath, ...wranglerArgs]
        const child = spawn("npx", args, {
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
      }),
    { exitCode: 1 }
  )

export const runDev = (
  args: string[],
  options?: { runWrangler?: RunWranglerDev; projectDir?: string }
): Effect.Effect<number, never, import("./commands.js").CommandServices> =>
  Effect.gen(function* () {
    const { stage, watch, wranglerArgs } = parseArgs(args)
    if (!stage) {
      return 1
    }
    const projectDir = options?.projectDir ?? process.cwd()

    const configResult = yield* resolveDevConfigPath(stage, projectDir)
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

    const result = options?.runWrangler
      ? yield* tryPromiseOr(
          () => options.runWrangler!(projectDir, configPath, wranglerArgs),
          { exitCode: 1 }
        )
      : yield* runWranglerDev(projectDir, configPath, wranglerArgs)

    return result.exitCode
  })
