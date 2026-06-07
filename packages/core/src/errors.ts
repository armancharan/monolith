import { Data } from "effect"

export class StateError extends Data.TaggedError("StateError")<{
  readonly message: string
}> {}

export class PlanError extends Data.TaggedError("PlanError")<{
  readonly message: string
}> {}
