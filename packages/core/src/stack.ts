import type { Effect } from "effect"
import { statePath } from "./paths.js"

export interface StackContext {
  /** Active deployment stage (e.g. dev, prod). */
  stage: string
  /** Resolved path to local JSON state for this stage. */
  statePath: string
}

export type StackConfigure = (ctx: StackContext) => Effect.Effect<void, never>

export interface StackModule {
  name: string
  configure: StackConfigure
}

export function stack(name: string, configure: StackConfigure): StackModule {
  return { name, configure }
}

export function createStackContext(stage: string): StackContext {
  return { stage, statePath: statePath(stage) }
}
