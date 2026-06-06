import { loadState, saveState, type MonolithState } from "@monolith/core"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { join } from "node:path"

const DEFAULT_STAGE = "dev"
const WRANGLER_CONFIG_CANDIDATES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]

export interface DeployArgs {
  stage: string
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
  const parsed: DeployArgs = { stage: DEFAULT_STAGE }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--stage" && args[index + 1]) {
      parsed.stage = args[index + 1]
      index += 1
    }
  }

  return parsed
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
  const { stage } = parseArgs(args)
  const projectDir = options?.projectDir ?? process.cwd()
  const deploy = options?.runWrangler ?? runWranglerDeploy

  const stateResult = await loadState(stage, projectDir)
  if (!stateResult.ok) {
    console.error(stateResult.error.message)
    console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
    return 1
  }

  const current = stateResult.value
  const configPath = await resolveWranglerConfigPath(current, projectDir)

  console.log(`Deploying stage "${stage}" via wrangler...`)
  if (configPath) {
    console.log(`  Config: ${configPath}`)
  }

  const result = await deploy(projectDir, configPath)
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

  return 0
}
