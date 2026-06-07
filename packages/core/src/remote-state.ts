import { StateError, type MonolithState, type Result } from "./state.js"

export type StateBackendKind = "local" | "r2"

export interface RemoteStateBackend {
  readonly kind: StateBackendKind
  pull(stage: string): Promise<Result<MonolithState, StateError>>
  push(stage: string, state: MonolithState): Promise<Result<void, StateError>>
}

export function stateObjectKey(stage: string): string {
  return `monolith/state/${stage}.json`
}

export function resolveStateBackendFromEnv(
  env: NodeJS.ProcessEnv = process.env
): StateBackendKind {
  const raw = env.MONOLITH_STATE_BACKEND?.trim().toLowerCase()
  if (raw === "r2") {
    return "r2"
  }
  return "local"
}
