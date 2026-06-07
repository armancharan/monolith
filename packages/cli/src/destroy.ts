import { clearState, formatPlan, isPreviewStage, loadState, previewWorkerName, type StateResource } from "@monolith/core"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { join } from "node:path"
import { evaluatePlan } from "./plan.js"
import { parseStageArgs, requireStage } from "./stage.js"

const DEFAULT_STAGE = "dev"
const WRANGLER_CONFIG_CANDIDATES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]

export interface DestroyArgs {
  stage: string
  autoApprove: boolean
  preview: boolean
}

export interface WranglerDeleteResult {
  exitCode: number
  output: string
}

export type RunWranglerDelete = (
  projectDir: string,
  workerName: string,
  configPath?: string
) => Promise<WranglerDeleteResult>

function parseArgs(args: string[]): DestroyArgs {
  const stageParsed = parseStageArgs(args, { defaultStage: DEFAULT_STAGE })
  const stage = requireStage(
    stageParsed,
    "Usage: monolith destroy [--stage <name>] [--preview] [--auto-approve]"
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

export function resolveDestroyWorkerName(
  workerName: string | undefined,
  stage: string
): string | undefined {
  if (!workerName) {
    return undefined
  }
  return previewWorkerName(workerName, stage)
}

export function findWorkerResource(resources: StateResource[]): StateResource | undefined {
  return resources.find((resource) => resource.kind === "worker")
}

export function bindingResourceSummary(resources: StateResource[]): string[] {
  const lines: string[] = []
  for (const resource of resources) {
    if (resource.kind === "worker") {
      continue
    }
    const label = resource.binding ?? resource.name ?? resource.id
    lines.push(`  ${resource.kind.toUpperCase()} binding "${label}" — NOT deleted (Cloudflare resource retained)`)
  }
  return lines
}

async function resolveWranglerConfigPath(
  wranglerConfigPath: string | undefined,
  projectDir: string
): Promise<string | undefined> {
  if (wranglerConfigPath) {
    return wranglerConfigPath
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

export async function runWranglerDelete(
  projectDir: string,
  workerName: string,
  configPath?: string
): Promise<WranglerDeleteResult> {
  const wranglerArgs = ["wrangler", "delete", workerName, "--force"]
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

export async function runDestroy(
  args: string[],
  options?: { runWranglerDelete?: RunWranglerDelete; projectDir?: string }
): Promise<number> {
  const { stage, autoApprove } = parseArgs(args)
  if (!stage) {
    return 1
  }
  const projectDir = options?.projectDir ?? process.cwd()
  const deleteWorker = options?.runWranglerDelete ?? runWranglerDelete

  const stateResult = await loadState(stage, projectDir)
  if (!stateResult.ok) {
    console.error(stateResult.error.message)
    console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
    return 1
  }

  const current = stateResult.value

  console.log(`Destroy plan for stage "${stage}":`)
  const evaluated = await evaluatePlan(stage, projectDir)
  if (evaluated.ok) {
    console.log(formatPlan(stage, evaluated.value.current, evaluated.value.plan))
  } else {
    console.log(`  (plan skipped: ${evaluated.message})`)
  }

  const worker = findWorkerResource(current.resources)
  const workerName = resolveDestroyWorkerName(worker?.name, stage)
  const bindingLines = bindingResourceSummary(current.resources)

  if (!autoApprove) {
    console.error("")
    console.error(`Destroy requires --auto-approve for stage "${stage}".`)
    if (workerName) {
      console.error(`  Worker to delete: ${workerName}`)
      if (isPreviewStage(stage) && worker?.name && workerName !== worker.name) {
        console.error(`  (preview suffix applied to base name "${worker.name}")`)
      }
    }
    if (bindingLines.length > 0) {
      console.error("  Bindings retained in Cloudflare (D1/KV/R2/Queue/DO not deleted):")
      for (const line of bindingLines) {
        console.error(line)
      }
    }
    return 1
  }

  if (!workerName) {
    console.log(`No worker resource in state for stage "${stage}" — clearing local state only.`)
    const clearResult = await clearState(stage, projectDir)
    if (!clearResult.ok) {
      console.error(clearResult.error.message)
      return 1
    }
    console.log(`  Removed .monolith/state/${stage}.json`)
    return 0
  }

  const configPath = await resolveWranglerConfigPath(current.wranglerConfigPath, projectDir)

  console.log("")
  console.log(`Deleting worker "${workerName}" via wrangler...`)
  if (configPath) {
    console.log(`  Config: ${configPath}`)
  }

  const result = await deleteWorker(projectDir, workerName, configPath)
  if (result.exitCode !== 0) {
    console.error(`Destroy failed: wrangler exited with code ${result.exitCode}`)
    return result.exitCode
  }

  const clearResult = await clearState(stage, projectDir)
  if (!clearResult.ok) {
    console.error(clearResult.error.message)
    return 1
  }

  console.log("")
  console.log(`Destroy succeeded for stage "${stage}"`)
  console.log(`  Worker "${workerName}" removed from Cloudflare`)
  console.log(`  Local state cleared: .monolith/state/${stage}.json`)
  if (bindingLines.length > 0) {
    console.log("")
    console.log("Safety note — binding resources were NOT deleted from your Cloudflare account:")
    for (const line of bindingLines) {
      console.log(line)
    }
    console.log("Remove D1 databases, KV namespaces, R2 buckets, etc. manually if needed.")
  }

  return 0
}
