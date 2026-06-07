import {
  formatBindingSummary,
  isPreviewStage,
  previewWorkerName,
  StateStore,
  summarizeBindings,
  type MonolithState
} from "@monolith/core"
import {
  detectDoMigrations,
  mergeVarsIntoWranglerConfig,
  parseWranglerConfigText,
  readStageVarsFile,
  writePreviewWranglerConfig
} from "@monolith/cloudflare"
import {
  deployWithDoMigration,
  WranglerDeployer,
  type WranglerDeployOutcome
} from "@monolith/cloudflare"
import { Effect } from "effect"
import { maybePushStateAfterDeploy } from "./state-remote.js"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tryPromiseOr } from "./effect-helpers.js"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { join } from "node:path"
import { ensurePlaceholderResources } from "./ensure-resources.js"
import { evaluatePlan } from "./plan.js"
import { parseStageArgs, requireStage } from "./stage.js"

const DEFAULT_STAGE = "dev"
const WRANGLER_CONFIG_CANDIDATES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]

export interface DeployArgs {
  stage: string
  autoApprove: boolean
  preview: boolean
  ensureResources: boolean
}

export interface ExecuteDeployResult {
  exitCode: number
  workerUrl?: string
  deployedAt?: string
}

export type RunWranglerDeploy = (
  projectDir: string,
  configPath?: string
) => Promise<WranglerDeployOutcome>

function parseArgs(args: string[]): DeployArgs {
  const stageParsed = parseStageArgs(args, { defaultStage: DEFAULT_STAGE })
  const stage = requireStage(
    stageParsed,
    "Usage: monolith deploy [--stage <name>] [--preview] [--auto-approve]"
  )
  if (!stage) {
    return {
      stage: "",
      autoApprove: false,
      preview: stageParsed.preview,
      ensureResources: args.includes("--ensure-resources")
    }
  }

  return {
    stage,
    preview: stageParsed.preview,
    autoApprove: args.includes("--auto-approve"),
    ensureResources: args.includes("--ensure-resources")
  }
}

export function parseWorkerUrlFromWranglerOutput(output: string): string | undefined {
  const matches = output.match(/https:\/\/[^\s]+\.workers\.dev\b/g)
  if (!matches || matches.length === 0) {
    return undefined
  }
  return matches[matches.length - 1]
}

const resolveWranglerConfigPath = (
  state: MonolithState,
  projectDir: string
): Effect.Effect<string | undefined, never> =>
  Effect.gen(function* () {
    if (state.wranglerConfigPath) {
      return state.wranglerConfigPath
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

const applyStageVarsToDeployConfig = (
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
    return varsPath
  })

const resolveDeployConfigPath = (
  state: MonolithState,
  stage: string,
  projectDir: string
): Effect.Effect<{ configPath?: string; previewWorkerName?: string }, never> =>
  Effect.gen(function* () {
    const baseConfigPath = yield* resolveWranglerConfigPath(state, projectDir)
    if (!baseConfigPath) {
      return {}
    }

    let configPath = baseConfigPath
    let previewWorkerNameValue: string | undefined

    if (isPreviewStage(stage)) {
      const worker = state.resources.find((resource) => resource.kind === "worker")
      const baseName = worker?.name ?? state.stackName
      previewWorkerNameValue = previewWorkerName(baseName, stage)
      configPath = yield* tryPromiseOr(
        () => writePreviewWranglerConfig(baseConfigPath, stage, projectDir),
        baseConfigPath
      )
    }

    configPath = yield* applyStageVarsToDeployConfig(configPath, stage, projectDir)

    return { configPath, previewWorkerName: previewWorkerNameValue }
  })

const runDeployCommand = (
  projectDir: string,
  configPath: string | undefined,
  parsedConfig: ReturnType<typeof parseWranglerConfigText> | undefined,
  runWrangler?: RunWranglerDeploy
): Effect.Effect<WranglerDeployOutcome, never, WranglerDeployer> =>
  Effect.gen(function* () {
    const deployer = yield* WranglerDeployer

    if (runWrangler) {
      if (parsedConfig) {
        return yield* tryPromiseOr(
          () => deployWithDoMigration(projectDir, configPath, runWrangler, parsedConfig),
          { exitCode: 1, output: "" }
        )
      }
      return yield* tryPromiseOr(() => runWrangler(projectDir, configPath), {
        exitCode: 1,
        output: ""
      })
    }

    const runDeployEffect = (cwd: string, cfg?: string) =>
      deployer.runDeploy(cwd, cfg).pipe(
        Effect.catch((message) => Effect.succeed({ exitCode: 1, output: message }))
      )

    if (parsedConfig) {
      return yield* tryPromiseOr(
        () =>
          deployWithDoMigration(
            projectDir,
            configPath,
            (cwd, cfg) => Effect.runPromise(runDeployEffect(cwd, cfg)),
            parsedConfig
          ),
        { exitCode: 1, output: "" }
      )
    }

    return yield* runDeployEffect(projectDir, configPath)
  })

export const runWranglerDeploy = (
  projectDir: string,
  configPath?: string
): Effect.Effect<WranglerDeployOutcome, never, WranglerDeployer> =>
  Effect.gen(function* () {
    const deployer = yield* WranglerDeployer
    return yield* deployer.runDeploy(projectDir, configPath).pipe(
      Effect.catch((message) => Effect.succeed({ exitCode: 1, output: message }))
    )
  })

export const executeDeploy = (options: {
  stage: string
  projectDir: string
  autoApprove?: boolean
  ensureResources?: boolean
  runWrangler?: RunWranglerDeploy
}): Effect.Effect<ExecuteDeployResult, never, import("./commands.js").CommandServices> =>
  Effect.gen(function* () {
    const {
      stage,
      projectDir,
      autoApprove = false,
      ensureResources = false,
      runWrangler
    } = options

    const stateStore = yield* StateStore

    const current = yield* stateStore.loadState(stage).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
        }).pipe(Effect.as({ exitCode: 1 } as ExecuteDeployResult))
      )
    )

    if ("exitCode" in current) {
      return current
    }

    let workingState = current

    if (!autoApprove) {
      const planEval = yield* evaluatePlan(stage, projectDir).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            console.error(error.message)
          }).pipe(Effect.as({ exitCode: 1 } as ExecuteDeployResult))
        )
      )

      if ("exitCode" in planEval) {
        return planEval
      }

      const hasPending = planEval.pending.hasChanges
      const hasDrift = planEval.cloud?.drift?.hasChanges ?? false

      if (hasPending || hasDrift) {
        if (hasPending) {
          console.error(`Plan has pending changes for stage "${stage}" (local state vs desired).`)
        }
        if (hasDrift) {
          console.error(`Cloud drift detected for stage "${stage}" (cloud vs desired).`)
        }
        console.error(
          "Review with `monolith plan --stage " + stage + "` or deploy with --auto-approve."
        )
        return { exitCode: 1 }
      }
    }

    const baseConfigPath = yield* resolveWranglerConfigPath(workingState, projectDir)
    if (baseConfigPath) {
      const ensureResult = yield* ensurePlaceholderResources({
        stage,
        projectDir,
        configPath: baseConfigPath,
        ensureResources
      }).pipe(
        Effect.catch((message) =>
          Effect.sync(() => {
            console.error(message)
          }).pipe(Effect.as({ exitCode: 1 } as ExecuteDeployResult))
        )
      )

      if ("exitCode" in ensureResult) {
        return ensureResult
      }

      workingState = ensureResult.state
    }

    const deployConfig = yield* resolveDeployConfigPath(workingState, stage, projectDir)
    const configPath = deployConfig.configPath

    let parsedConfig
    if (configPath) {
      parsedConfig = yield* tryPromiseOr(async () => {
        const content = await readFile(join(projectDir, configPath), "utf8")
        return parseWranglerConfigText(content, configPath)
      }, undefined)
    }

    const preview = isPreviewStage(stage)
    const bindingSummary = formatBindingSummary(
      summarizeBindings(workingState.resources, { previewStage: preview }),
      { previewStage: preview }
    )

    console.log(`Deploying stage "${stage}" via wrangler...`)
    if (configPath) {
      console.log(`  Config: ${configPath}`)
    }
    console.log(bindingSummary)
    if (deployConfig.previewWorkerName) {
      console.log(`  Preview worker: ${deployConfig.previewWorkerName}`)
      console.log(
        "  Note: preview uses a suffixed workers.dev name; D1/KV/R2 bindings remain shared with base stage."
      )
    }

    if (parsedConfig) {
      const migration = detectDoMigrations(parsedConfig)
      if (migration.requiresTwoStepDeploy) {
        console.log(
          `  DO migration detected (${migration.migrationTags.join(", ") || "untagged"}) — two-step deploy`
        )
      }
    }

    const result = yield* runDeployCommand(projectDir, configPath, parsedConfig, runWrangler)

    if (result.exitCode !== 0) {
      console.error(`Deploy failed: wrangler exited with code ${result.exitCode}`)
      return { exitCode: result.exitCode }
    }

    const deployedAt = new Date().toISOString()
    const workerUrl = parseWorkerUrlFromWranglerOutput(result.output)
    const nextState: MonolithState = {
      ...workingState,
      updatedAt: deployedAt,
      deployedAt,
      workerUrl
    }

    const saveExit = yield* stateStore.saveState(stage, nextState).pipe(
      Effect.as(0),
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return 1
        })
      )
    )
    if (saveExit !== 0) {
      return { exitCode: 1 }
    }

    console.log("")
    console.log(`Deploy succeeded for stage "${stage}"`)
    if (workerUrl) {
      console.log(`  Worker URL: ${workerUrl}`)
    }
    console.log(`  State updated: .monolith/state/${stage}.json`)
    yield* maybePushStateAfterDeploy(stage, nextState, projectDir)

    return { exitCode: 0, workerUrl, deployedAt }
  })

export const runDeploy = (
  args: string[],
  options?: {
    runWrangler?: RunWranglerDeploy
    projectDir?: string
  }
): Effect.Effect<number, never, import("./commands.js").CommandServices> =>
  Effect.gen(function* () {
    const { stage, autoApprove, ensureResources } = parseArgs(args)
    if (!stage) {
      return 1
    }
    const projectDir = options?.projectDir ?? process.cwd()

    const result = yield* executeDeploy({
      stage,
      projectDir,
      autoApprove,
      ensureResources,
      runWrangler: options?.runWrangler
    })

    return result.exitCode
  })
