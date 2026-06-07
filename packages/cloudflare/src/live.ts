import { Layer } from "effect"
import { CloudflareClientLive, makeCloudflareClientLayer } from "./services/CloudflareClient.js"
import { WranglerDeployerLive } from "./services/WranglerDeployer.js"

export const makeCloudflareLive = (
  projectDir: string,
  options?: { fetchImpl?: typeof fetch }
) => Layer.mergeAll(makeCloudflareClientLayer(projectDir, options?.fetchImpl), WranglerDeployerLive)

export const CloudflareLive = CloudflareClientLive.pipe(Layer.provideMerge(WranglerDeployerLive))
