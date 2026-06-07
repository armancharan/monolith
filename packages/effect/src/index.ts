import { executeDeploy } from "@monolith/cli/deploy"
import { CloudflareClient } from "@monolith/cloudflare"
import { loadState, planState, StateError } from "@monolith/core"
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
      projectDir?: string,
      options?: { autoApprove?: boolean }
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

  deploy: (stage, projectDir = process.cwd(), options) =>
    Effect.tryPromise({
      try: async () => {
        const result = await executeDeploy({
          stage,
          projectDir,
          autoApprove: options?.autoApprove ?? true
        })
        if (result.exitCode !== 0) {
          throw new Error(`Deploy failed with exit code ${result.exitCode}`)
        }
        return {
          stage,
          workerUrl: result.workerUrl,
          deployedAt: result.deployedAt ?? new Date().toISOString()
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
