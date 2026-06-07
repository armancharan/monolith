import {
  formatBindingSummary,
  isPreviewStage,
  loadState,
  previewWorkerName,
  saveState,
  summarizeBindings,
  type MonolithState
} from "@monolith/core"
import {
  deployWithDoMigration,
  detectDoMigrations,
  mergeVarsIntoWranglerConfig,
  parseWranglerConfigText,
  readStageVarsFile,
  writePreviewWranglerConfig
} from "@monolith/cloudflare"
import { maybePushStateAfterDeploy } from "./state-remote.js"
import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { join } from "node:path"
import { evaluatePlan } from "./plan.js"
import { parseStageArgs, requireStage } from "./stage.js"

const DEFAULT_STAGE = "dev"
const WRANGLER_CONFIG_CANDIDATES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]

export interface DeployArgs {
  stage: string
  autoApprove: boolean
  preview: boolean
}

export interface WranglerDeployResult {
  exitCode: number
  output: string
}

export type RunWranglerDeploy = (
  projectDir: string,
  configPath?: string
) => Promise<WranglerDeployResult>

function parseArgs(args: string[]): DeployArgs {
  const stageParsed = parseStageArgs(args, { defaultStage: DEFAULT_STAGE })
  const stage = requireStage(
    stageParsed,
    "Usage: monolith deploy [--stage <name>] [--preview] [--auto-approve]"
  )
  if (!stage) {
    return { stage: "", autoApprove: false, preview: stageParsed.preview }
  }

  return {
    stage,
    preview: stageParsed.preview,
    autoApprove: args.includes("--auto-approve")
  }
}

export function parseWorkerUrlFromWranglerOutput(output: string): string | undefined {
  const matches = output.match(/https:\/\/[^\s]+\.workers\.dev\b/g)
  if (!matches || matches.length === 0) {
    return undefined
  }
  return matches[matches.length - 1]
}

async function resolveWranglerConfigPath(
  state: MonolithState,
  projectDir: string
): Promise<string | undefined> {
  if (state.wranglerConfigPath) {
    return state.wranglerConfigPath
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

async function applyStageVarsToDeployConfig(
  configPath: string,
  stage: string,
  projectDir: string
): Promise<string> {
  const stageVars = await readStageVarsFile(stage, projectDir)
  if (!stageVars?.vars || Object.keys(stageVars.vars).length === 0) {
    return configPath
  }

  const { mkdir, readFile, writeFile } = await import("node:fs/promises")
  const absolutePath = join(projectDir, configPath)
  const content = await readFile(absolutePath, "utf8")
  const parsed = JSON.parse(content) as Record<string, unknown>
  const merged = mergeVarsIntoWranglerConfig(parsed, stageVars.vars)
  const varsPath = `.monolith/wrangler.${stage}.vars.jsonc`
  const varsAbsolute = join(projectDir, varsPath)

  await mkdir(join(projectDir, ".monolith"), { recursive: true })
  await writeFile(varsAbsolute, `${JSON.stringify(merged, null, 2)}\n`, "utf8")
  return varsPath
}

async function resolveDeployConfigPath(
  state: MonolithState,
  stage: string,
  projectDir: string
): Promise<{ configPath?: string; previewWorkerName?: string }> {
  const baseConfigPath = await resolveWranglerConfigPath(state, projectDir)
  if (!baseConfigPath) {
    return {}
  }

  let configPath = baseConfigPath
  let previewWorkerNameValue: string | undefined

  if (isPreviewStage(stage)) {
    const worker = state.resources.find((resource) => resource.kind === "worker")
    const baseName = worker?.name ?? state.stackName
    previewWorkerNameValue = previewWorkerName(baseName, stage)
    configPath = await writePreviewWranglerConfig(baseConfigPath, stage, projectDir)
  }

  configPath = await applyStageVarsToDeployConfig(configPath, stage, projectDir)

  return { configPath, previewWorkerName: previewWorkerNameValue }
}

export async function runWranglerDeploy(
  projectDir: string,
  configPath?: string
): Promise<WranglerDeployResult> {
  const wranglerArgs = ["wrangler", "deploy"]
  if (configPath) {
    wranglerArgs.push("--config", configPath)
  }

  return new Promise((resolve) => {
    const child = spawn("npx", wranglerArgs, {
      cwd: projectDir,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"]
    })

    let output = ""

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
    })

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString()
      output += text
      process.stderr.write(text)
    })

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        output
      })
    })

    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        output: `${output}${error.message}\n`
      })
    })
  })
}

export async function runDeploy(
  args: string[],
  options?: { runWrangler?: RunWranglerDeploy; projectDir?: string }
): Promise<number> {
  const { stage, autoApprove } = parseArgs(args)
  if (!stage) {
    return 1
  }
  const projectDir = options?.projectDir ?? process.cwd()
  const deploy = options?.runWrangler ?? runWranglerDeploy

  const stateResult = await loadState(stage, projectDir)
  if (!stateResult.ok) {
    console.error(stateResult.error.message)
    console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
    return 1
  }

  const current = stateResult.value

  if (!autoApprove) {
    const planEval = await evaluatePlan(stage, projectDir)
    if (!planEval.ok) {
      console.error(planEval.message)
      return planEval.exitCode
    }

    const hasPending = planEval.value.pending.hasChanges
    const hasDrift = planEval.value.cloud?.drift?.hasChanges ?? false

    if (hasPending || hasDrift) {
      if (hasPending) {
        console.error(`Plan has pending changes for stage "${stage}" (local state vs desired).`)
      }
      if (hasDrift) {
        console.error(`Cloud drift detected for stage "${stage}" (cloud vs desired).`)
      }
      console.error("Review with `monolith plan --stage " + stage + "` or deploy with --auto-approve.")
      return 1
    }
  }

  const deployConfig = await resolveDeployConfigPath(current, stage, projectDir)
  const configPath = deployConfig.configPath

  let parsedConfig
  if (configPath) {
    try {
      const content = await readFile(join(projectDir, configPath), "utf8")
      parsedConfig = parseWranglerConfigText(content, configPath)
    } catch {
      parsedConfig = undefined
    }
  }

  const preview = isPreviewStage(stage)
  const bindingSummary = formatBindingSummary(
    summarizeBindings(current.resources, { previewStage: preview }),
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

  const result =
    parsedConfig
      ? await deployWithDoMigration(projectDir, configPath, deploy, parsedConfig)
      : await deploy(projectDir, configPath)
  if (result.exitCode !== 0) {
    console.error(`Deploy failed: wrangler exited with code ${result.exitCode}`)
    return result.exitCode
  }

  const deployedAt = new Date().toISOString()
  const workerUrl = parseWorkerUrlFromWranglerOutput(result.output)
  const nextState: MonolithState = {
    ...current,
    updatedAt: deployedAt,
    deployedAt,
    workerUrl
  }

  const saveResult = await saveState(stage, nextState, projectDir)
  if (!saveResult.ok) {
    console.error(saveResult.error.message)
    return 1
  }

  console.log("")
  console.log(`Deploy succeeded for stage "${stage}"`)
  if (workerUrl) {
    console.log(`  Worker URL: ${workerUrl}`)
  }
  console.log(`  State updated: .monolith/state/${stage}.json`)
  await maybePushStateAfterDeploy(stage, nextState, projectDir)

  return 0
}
