import { Effect } from "effect"
import { makeMonolithLive } from "./live.js"

export function runCli<A, E = never, R = never>(
  projectDir: string,
  program: Effect.Effect<A, E, R>
): Promise<A> {
  return Effect.runPromise(
    program.pipe(Effect.provide(makeMonolithLive(projectDir))) as Effect.Effect<A, never, never>
  )
}
