import { Context, Effect, Layer } from "effect"
import {
  planState,
  type PlanDesiredSource,
  type PlanResult
} from "../plan.js"
import type { MonolithState } from "../state.js"

export class PlanEngine extends Context.Service<
  PlanEngine,
  {
    readonly plan: (
      current: MonolithState,
      desired: MonolithState,
      desiredSource?: PlanDesiredSource
    ) => Effect.Effect<PlanResult, never>
  }
>()("PlanEngine") {}

export const PlanEngineLive = Layer.succeed(
  PlanEngine,
  PlanEngine.of({
    plan: (current, desired, desiredSource = "import") =>
      Effect.succeed({
        ...planState(current, desired),
        desiredSource
      })
  })
)
