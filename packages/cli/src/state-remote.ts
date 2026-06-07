import {
  resolveStateBackendFromEnv,
  StateError,
  StateStore,
  type MonolithState,
  type RemoteStateBackend
} from "@monolith/core"
import { R2StateBackend } from "@monolith/cloudflare"
import { Effect } from "effect"
import { parseStageArgs, requireStage } from "./stage.js"

function parseArgs(args: string[]): { stage?: string; preview: boolean } {
  const stageParsed = parseStageArgs(args)
  const stage = requireStage(
    stageParsed,
    "Usage: monolith state pull|push --stage <name> [--preview]"
  )
  return { stage, preview: stageParsed.preview }
}

export const resolveRemoteBackend = (
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env
): Effect.Effect<RemoteStateBackend, StateError> =>
  Effect.gen(function* () {
    const kind = resolveStateBackendFromEnv(env)
    if (kind === "local") {
      return yield* Effect.fail(
        new StateError({
          message:
            "Remote state not configured. Set MONOLITH_STATE_BACKEND=r2 and MONOLITH_STATE_R2_BUCKET."
        })
      )
    }

    return yield* R2StateBackend.fromEnv(env, { projectDir })
  })

export const runStatePull = (
  args: string[],
  projectDir = process.cwd()
): Effect.Effect<number, never, StateStore> =>
  Effect.gen(function* () {
    const { stage } = parseArgs(args)
    if (!stage) {
      return 1
    }

    const backend = yield* resolveRemoteBackend(projectDir).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return 1
        })
      )
    )

    if (typeof backend === "number") {
      return backend
    }

    const stateStore = yield* StateStore
    const pulled = yield* backend.pull(stage).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return 1
        })
      )
    )

    if (typeof pulled === "number") {
      return pulled
    }

    const saveFailed = yield* stateStore.saveState(stage, pulled).pipe(
      Effect.as(false),
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return true
        })
      )
    )

    if (saveFailed) {
      return 1
    }

    console.log(`Pulled remote state for stage "${stage}" → .monolith/state/${stage}.json`)
    return 0
  })

export const runStatePush = (
  args: string[],
  projectDir = process.cwd()
): Effect.Effect<number, never, StateStore> =>
  Effect.gen(function* () {
    const { stage } = parseArgs(args)
    if (!stage) {
      return 1
    }

    const stateStore = yield* StateStore
    const local = yield* stateStore.loadState(stage).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return 1
        })
      )
    )

    if (typeof local === "number") {
      return local
    }

    const backend = yield* resolveRemoteBackend(projectDir).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return 1
        })
      )
    )

    if (typeof backend === "number") {
      return backend
    }

    const pushFailed = yield* backend.push(stage, local).pipe(
      Effect.as(false),
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return true
        })
      )
    )

    if (pushFailed) {
      return 1
    }

    console.log(`Pushed local state for stage "${stage}" → remote (${backend.kind})`)
    return 0
  })

export const maybePushStateAfterDeploy = (
  stage: string,
  state: MonolithState,
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    if (resolveStateBackendFromEnv(env) !== "r2") {
      return
    }

    const backend = yield* resolveRemoteBackend(projectDir, env).pipe(Effect.result)
    if (backend._tag === "Failure") {
      console.log(`  Remote state push skipped: ${backend.failure.message}`)
      return
    }

    const pushResult = yield* backend.success.push(stage, state).pipe(Effect.result)
    if (pushResult._tag === "Failure") {
      console.log(`  Remote state push failed: ${pushResult.failure.message}`)
      return
    }

    console.log(`  Remote state pushed (${backend.success.kind})`)
  })
