import { CloudflareClient } from "@monolith/cloudflare"
import { loadState, planState, saveState, StateError, type MonolithState } from "@monolith/core"
import { Context, Data, Effect, Layer } from "effect"

export class MonolithStateError extends Data.TaggedError("MonolithStateError")<{
  message: string
}> {}

function toMonolithError(error: StateError): MonolithStateError {
  return new MonolithStateError({ message: error.message })
}

export class CloudflareClientService extends Context.Tag("CloudflareClientService")<
  CloudflareClientService,
  CloudflareClient
>() {}

export const CloudflareClientLive = Layer.effect(
  CloudflareClientService,
  Effect.tryPromise({
    try: async () => {
      const result = await CloudflareClient.create()
      if (!result.ok) {
        throw result.error
      }
      return result.value
    },
    catch: (cause) =>
      new MonolithStateError({
        message: cause instanceof Error ? cause.message : String(cause)
      })
  })
)

export interface MonolithPlanResult {
  stage: string
  pendingChanges: number
  hasChanges: boolean
}

export interface MonolithDeployResult {
  stage: string
  workerUrl?: string
  deployedAt: string
}

export class MonolithEffect extends Context.Tag("MonolithEffect")<
  MonolithEffect,
  {
    readonly plan: (
      stage: string,
      projectDir?: string
    ) => Effect.Effect<MonolithPlanResult, MonolithStateError>
    readonly deploy: (
      stage: string,
      state: MonolithState,
      projectDir?: string
    ) => Effect.Effect<MonolithDeployResult, MonolithStateError>
  }
>() {}

/** Stub adapter — plan/deploy as Effects without rewriting the CLI. */
export const MonolithEffectLive = Layer.succeed(MonolithEffect, {
  plan: (stage, projectDir = process.cwd()) =>
    Effect.tryPromise({
      try: async () => {
        const current = await loadState(stage, projectDir)
        if (!current.ok) {
          throw current.error
        }
        const pending = planState(current.value, current.value)
        return {
          stage,
          pendingChanges: pending.changes.length,
          hasChanges: pending.hasChanges
        }
      },
      catch: (cause) =>
        cause instanceof StateError
          ? toMonolithError(cause)
          : new MonolithStateError({
              message: cause instanceof Error ? cause.message : String(cause)
            })
    }),

  deploy: (stage, state, projectDir = process.cwd()) =>
    Effect.tryPromise({
      try: async () => {
        const deployedAt = new Date().toISOString()
        const next: MonolithState = {
          ...state,
          updatedAt: deployedAt,
          deployedAt,
          workerUrl: state.workerUrl
        }
        const saved = await saveState(stage, next, projectDir)
        if (!saved.ok) {
          throw saved.error
        }
        return {
          stage,
          workerUrl: next.workerUrl,
          deployedAt
        }
      },
      catch: (cause) =>
        cause instanceof StateError
          ? toMonolithError(cause)
          : new MonolithStateError({
              message: cause instanceof Error ? cause.message : String(cause)
            })
    })
})
