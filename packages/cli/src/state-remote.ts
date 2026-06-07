import {
  loadState,
  resolveStateBackendFromEnv,
  saveState,
  type MonolithState,
  type RemoteStateBackend
} from "@monolith/core"
import { R2StateBackend } from "@monolith/cloudflare"
import { parseStageArgs, requireStage } from "./stage.js"

function parseArgs(args: string[]): { stage?: string; preview: boolean } {
  const stageParsed = parseStageArgs(args)
  const stage = requireStage(
    stageParsed,
    "Usage: monolith state pull|push --stage <name> [--preview]"
  )
  return { stage, preview: stageParsed.preview }
}

export function resolveRemoteBackend(
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env
): { ok: true; backend: RemoteStateBackend } | { ok: false; message: string } {
  const kind = resolveStateBackendFromEnv(env)
  if (kind === "local") {
    return {
      ok: false,
      message:
        "Remote state not configured. Set MONOLITH_STATE_BACKEND=r2 and MONOLITH_STATE_R2_BUCKET."
    }
  }

  const backendResult = R2StateBackend.fromEnv(env, { projectDir })
  if (!backendResult.ok) {
    return { ok: false, message: backendResult.error.message }
  }

  return { ok: true, backend: backendResult.value }
}

export async function runStatePull(args: string[], projectDir = process.cwd()): Promise<number> {
  const { stage } = parseArgs(args)
  if (!stage) {
    return 1
  }

  const backendResult = resolveRemoteBackend(projectDir)
  if (!backendResult.ok) {
    console.error(backendResult.message)
    return 1
  }

  const pullResult = await backendResult.backend.pull(stage)
  if (!pullResult.ok) {
    console.error(pullResult.error.message)
    return 1
  }

  const saveResult = await saveState(stage, pullResult.value, projectDir)
  if (!saveResult.ok) {
    console.error(saveResult.error.message)
    return 1
  }

  console.log(`Pulled remote state for stage "${stage}" → .monolith/state/${stage}.json`)
  return 0
}

export async function runStatePush(args: string[], projectDir = process.cwd()): Promise<number> {
  const { stage } = parseArgs(args)
  if (!stage) {
    return 1
  }

  const local = await loadState(stage, projectDir)
  if (!local.ok) {
    console.error(local.error.message)
    return 1
  }

  const backendResult = resolveRemoteBackend(projectDir)
  if (!backendResult.ok) {
    console.error(backendResult.message)
    return 1
  }

  const pushResult = await backendResult.backend.push(stage, local.value)
  if (!pushResult.ok) {
    console.error(pushResult.error.message)
    return 1
  }

  console.log(`Pushed local state for stage "${stage}" → remote (${backendResult.backend.kind})`)
  return 0
}

export async function maybePushStateAfterDeploy(
  stage: string,
  state: MonolithState,
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (resolveStateBackendFromEnv(env) !== "r2") {
    return
  }

  const backendResult = resolveRemoteBackend(projectDir, env)
  if (!backendResult.ok) {
    console.log(`  Remote state push skipped: ${backendResult.message}`)
    return
  }

  const pushResult = await backendResult.backend.push(stage, state)
  if (!pushResult.ok) {
    console.log(`  Remote state push failed: ${pushResult.error.message}`)
    return
  }

  console.log(`  Remote state pushed (${backendResult.backend.kind})`)
}
