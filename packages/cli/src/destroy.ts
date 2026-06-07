import {
  formatPlan,
  isPreviewStage,
  previewWorkerName,
  StateStore,
  type StateResource
} from "@monolith/core"
import { WranglerDeployer, type WranglerDeployerOutcome } from "@monolith/cloudflare"
import { Effect } from "effect"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { join } from "node:path"
import { evaluatePlan } from "./plan.js"
import { tryPromiseOr } from "./effect-helpers.js"
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

const resolveWranglerConfigPath = (
  wranglerConfigPath: string | undefined,
  projectDir: string
): Effect.Effect<string | undefined, never> =>
  Effect.gen(function* () {
    if (wranglerConfigPath) {
      return wranglerConfigPath
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

export const runWranglerDelete = (
  projectDir: string,
  workerName: string,
  configPath?: string
): Effect.Effect<WranglerDeployerOutcome, never, WranglerDeployer> =>
  Effect.gen(function* () {
    const deployer = yield* WranglerDeployer
    const args = ["wrangler", "delete", workerName, "--force"]
    if (configPath) {
      args.push("--config", configPath)
    }
    return yield* deployer.runCommand(args, { cwd: projectDir }).pipe(
      Effect.catch((message) => Effect.succeed({ exitCode: 1, output: message }))
    )
  })

export const runDestroy = (
  args: string[],
  options?: { runWranglerDelete?: RunWranglerDelete; projectDir?: string }
): Effect.Effect<number, never, import("./commands.js").CommandServices> =>
  Effect.gen(function* () {
    const { stage, autoApprove } = parseArgs(args)
    if (!stage) {
      return 1
    }
    const projectDir = options?.projectDir ?? process.cwd()
    const stateStore = yield* StateStore

    const current = yield* stateStore.loadState(stage).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
          return 1
        })
      )
    )

    if (typeof current === "number") {
      return current
    }

    console.log(`Destroy plan for stage "${stage}":`)
    const evaluated = yield* evaluatePlan(stage, projectDir).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.log(`  (plan skipped: ${error.message})`)
          return undefined
        })
      )
    )

    if (evaluated) {
      console.log(formatPlan(stage, evaluated.current, evaluated.pending))
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
      const clearFailed = yield* stateStore.clearState(stage).pipe(
        Effect.as(false),
        Effect.catch((error) =>
          Effect.sync(() => {
            console.error(error.message)
            return true
          })
        )
      )
      if (clearFailed) {
        return 1
      }
      console.log(`  Removed .monolith/state/${stage}.json`)
      return 0
    }

    const configPath = yield* resolveWranglerConfigPath(current.wranglerConfigPath, projectDir)

    console.log("")
    console.log(`Deleting worker "${workerName}" via wrangler...`)
    if (configPath) {
      console.log(`  Config: ${configPath}`)
    }

    const result = options?.runWranglerDelete
      ? yield* tryPromiseOr(
          () => options.runWranglerDelete!(projectDir, workerName, configPath),
          { exitCode: 1, output: "" }
        )
      : yield* runWranglerDelete(projectDir, workerName, configPath)

    if (result.exitCode !== 0) {
      console.error(`Destroy failed: wrangler exited with code ${result.exitCode}`)
      return result.exitCode
    }

    const clearFailed = yield* stateStore.clearState(stage).pipe(
      Effect.as(false),
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return true
        })
      )
    )
    if (clearFailed) {
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
  })
