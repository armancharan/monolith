import { Context, Effect, Layer } from "effect"
import { StateError } from "../errors.js"
import {
  type PlanDesiredSource,
  type PlanResult
} from "../plan.js"
import {
  stateFromImportSnapshot,
  type ImportSnapshot,
  type MonolithState
} from "../state.js"
import { PlanEngine, PlanEngineLive } from "./PlanEngine.js"
import { StateStore, StateStoreLive } from "./StateStore.js"

export interface ResolvedDesired {
  readonly state: MonolithState
  readonly source: PlanDesiredSource
}

export class ReconcileProgram extends Context.Service<
  ReconcileProgram,
  {
    readonly resolveDesiredFromImport: (
      snapshot: ImportSnapshot,
      stage: string,
      options?: {
        importSnapshotPath?: string
        wranglerConfigPath?: string
      },
      source?: PlanDesiredSource
    ) => ResolvedDesired

    readonly evaluate: (
      current: MonolithState,
      desired: MonolithState,
      desiredSource?: PlanDesiredSource
    ) => Effect.Effect<PlanResult, never>

    readonly evaluatePending: (
      stage: string,
      desired: MonolithState,
      desiredSource?: PlanDesiredSource
    ) => Effect.Effect<
      { current: MonolithState; pending: PlanResult },
      StateError
    >
  }
>()("ReconcileProgram") {}

export const ReconcileProgramLive = Layer.effect(
  ReconcileProgram,
  Effect.gen(function* () {
    const planEngine = yield* PlanEngine
    const stateStore = yield* StateStore

    return ReconcileProgram.of({
      resolveDesiredFromImport: (snapshot, stage, options, source = "import") => ({
        state: stateFromImportSnapshot(snapshot, stage, options),
        source
      }),

      evaluate: (current, desired, desiredSource) =>
        planEngine.plan(current, desired, desiredSource),

      evaluatePending: (stage, desired, desiredSource) =>
        Effect.gen(function* () {
          const current = yield* stateStore.loadState(stage)
          const pending = yield* planEngine.plan(current, desired, desiredSource)
          return { current, pending }
        })
    })
  })
)

export const CoreServicesLive = ReconcileProgramLive.pipe(
  Layer.provide(PlanEngineLive),
  Layer.provide(StateStoreLive)
)
