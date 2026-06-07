import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { StateError } from "../errors.js"
import { STATE_DIR, statePath } from "../paths.js"
import {
  stateFilePath,
  stateFromImportSnapshot,
  type ImportSnapshot,
  type MonolithState
} from "../state.js"

export class StateStore extends Context.Service<
  StateStore,
  {
    readonly loadState: (
      stage: string
    ) => Effect.Effect<MonolithState, StateError>
    readonly saveState: (
      stage: string,
      data: MonolithState
    ) => Effect.Effect<string, StateError>
    readonly initStateFromImport: (
      importPath: string,
      stage: string,
      options?: { wranglerConfigPath?: string }
    ) => Effect.Effect<MonolithState, StateError>
    readonly clearState: (stage: string) => Effect.Effect<void, StateError>
  }
>()("StateStore") {}

export const makeStateStore = (projectDir = process.cwd()) => {
  const loadState = (stage: string): Effect.Effect<MonolithState, StateError> =>
    Effect.gen(function* () {
      const filePath = stateFilePath(stage, projectDir)

      const text = yield* Effect.tryPromise({
        try: () => readFile(filePath, "utf8"),
        catch: () =>
          new StateError({ message: `State file not found: ${statePath(stage)}` })
      })

      let parsed: MonolithState
      try {
        parsed = JSON.parse(text) as MonolithState
      } catch {
        return yield* Effect.fail(
          new StateError({ message: `Could not parse state JSON: ${statePath(stage)}` })
        )
      }

      if (!parsed.stackName || !parsed.stage || !Array.isArray(parsed.resources)) {
        return yield* Effect.fail(
          new StateError({ message: `Invalid state file: ${statePath(stage)}` })
        )
      }

      return parsed
    })

  const saveState = (
    stage: string,
    data: MonolithState
  ): Effect.Effect<string, StateError> =>
    Effect.gen(function* () {
      const filePath = stateFilePath(stage, projectDir)
      const dirPath = join(projectDir, STATE_DIR)

      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(dirPath, { recursive: true })
          await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
        },
        catch: (cause) =>
          new StateError({
            message: `Could not write state file: ${
              cause instanceof Error ? cause.message : String(cause)
            }`
          })
      })

      return statePath(stage)
    })

  const initStateFromImport = (
    importPath: string,
    stage: string,
    options?: { wranglerConfigPath?: string }
  ): Effect.Effect<MonolithState, StateError> =>
    Effect.gen(function* () {
      const resolvedImportPath = join(projectDir, importPath)

      const text = yield* Effect.tryPromise({
        try: () => readFile(resolvedImportPath, "utf8"),
        catch: () =>
          new StateError({ message: `Import snapshot not found: ${importPath}` })
      })

      let snapshot: ImportSnapshot
      try {
        snapshot = JSON.parse(text) as ImportSnapshot
      } catch {
        return yield* Effect.fail(
          new StateError({ message: `Could not parse import snapshot: ${importPath}` })
        )
      }

      if (!snapshot.workerName || !snapshot.contentHash) {
        return yield* Effect.fail(
          new StateError({
            message: `Import snapshot missing workerName or contentHash: ${importPath}`
          })
        )
      }

      const state = stateFromImportSnapshot(snapshot, stage, {
        importSnapshotPath: importPath,
        wranglerConfigPath: options?.wranglerConfigPath
      })

      yield* saveState(stage, state)
      return state
    })

  const clearState = (stage: string): Effect.Effect<void, StateError> =>
    Effect.tryPromise({
      try: async () => {
        try {
          await unlink(stateFilePath(stage, projectDir))
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
            throw cause
          }
        }
      },
      catch: (cause) =>
        new StateError({
          message: `Could not remove state file: ${
            cause instanceof Error ? cause.message : String(cause)
          }`
        })
    })

  return StateStore.of({
    loadState,
    saveState,
    initStateFromImport,
    clearState
  })
}

export const makeStateStoreLayer = (
  projectDir = process.cwd()
): Layer.Layer<StateStore> => Layer.succeed(StateStore, makeStateStore(projectDir))

export const StateStoreLive = makeStateStoreLayer()
