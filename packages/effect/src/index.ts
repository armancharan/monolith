import {
  makeStateStoreLayer,
  PlanEngineLive,
  ReconcileProgramLive
} from "@monolith/core"
import { makeCloudflareLive } from "@monolith/cloudflare"
import { Layer } from "effect"

/** Compose core + Cloudflare Layers for a project directory. */
export const makeMonolithLive = (projectDir = process.cwd()) => {
  const stateStoreLayer = makeStateStoreLayer(projectDir)
  const coreLayer = ReconcileProgramLive.pipe(
    Layer.provide(PlanEngineLive),
    Layer.provide(stateStoreLayer)
  )

  return Layer.mergeAll(stateStoreLayer, coreLayer, makeCloudflareLive(projectDir))
}

export const MonolithLive = makeMonolithLive()

export {
  CoreServicesLive,
  PlanEngine,
  PlanEngineLive,
  PlanError,
  ReconcileProgram,
  ReconcileProgramLive,
  StateError,
  StateStore,
  makeStateStoreLayer
} from "@monolith/core"

export {
  CloudflareApiError,
  CloudflareAuthError,
  CloudflareClient,
  CloudflareLive,
  WranglerDeployer,
  WranglerError,
  makeCloudflareLive
} from "@monolith/cloudflare"
