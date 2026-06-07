import { Effect } from "effect"

export const tryPromiseOr = <A>(
  tryFn: () => Promise<A>,
  fallback: A
): Effect.Effect<A, never> =>
  Effect.catch(
    Effect.tryPromise({
      try: tryFn,
      catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause))
    }),
    () => Effect.succeed(fallback)
  )

export const mapErrorToExit = <A, E>(
  effect: Effect.Effect<A, E>,
  onError: (error: E) => number
): Effect.Effect<A | number, never> =>
  Effect.catch(effect, (error) => Effect.succeed(onError(error)))
