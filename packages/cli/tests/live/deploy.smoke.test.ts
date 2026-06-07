import { Effect } from "effect"
import {
  makeCloudflareClient,
  resolveCloudflareAuth
} from "@monolith/cloudflare"
import { describe, expect, it } from "vitest"

const LIVE_ENABLED = process.env.MONOLITH_LIVE_TESTS === "1"

async function hasCloudflareAuth(): Promise<boolean> {
  const result = await Effect.runPromise(
    resolveCloudflareAuth().pipe(
      Effect.map(() => true),
      Effect.catch(() => Effect.succeed(false))
    )
  )
  return result
}

describe("live deploy smoke", () => {
  it("whoami succeeds with Cloudflare credentials", async (ctx) => {
    if (!LIVE_ENABLED) {
      ctx.skip()
      return
    }

    const hasAuth = await hasCloudflareAuth()
    if (!hasAuth) {
      console.log(
        "SKIP: Live tests need CLOUDFLARE_API_TOKEN or wrangler OAuth (run `wrangler login`)"
      )
      ctx.skip()
      return
    }

    const auth = await Effect.runPromise(resolveCloudflareAuth())
    const client = makeCloudflareClient({ token: auth.token })
    const whoami = await Effect.runPromise(client.whoami())

    expect(whoami.user.id).toBeTruthy()
    expect(whoami.accounts.length).toBeGreaterThan(0)
  })

  it("optional worker /health responds when MONOLITH_LIVE_WORKER_URL is set", async (ctx) => {
    if (!LIVE_ENABLED) {
      ctx.skip()
      return
    }

    const workerUrl = process.env.MONOLITH_LIVE_WORKER_URL?.trim()
    if (!workerUrl) {
      console.log(
        "SKIP: Set MONOLITH_LIVE_WORKER_URL (e.g. https://monolith-m1-dogfood.<subdomain>.workers.dev) for HTTP smoke"
      )
      ctx.skip()
      return
    }

    const hasAuth = await hasCloudflareAuth()
    if (!hasAuth) {
      console.log(
        "SKIP: Live tests need CLOUDFLARE_API_TOKEN or wrangler OAuth (run `wrangler login`)"
      )
      ctx.skip()
      return
    }

    const healthUrl = new URL("/health", workerUrl.endsWith("/") ? workerUrl : `${workerUrl}/`)
    const response = await fetch(healthUrl)
    expect(response.ok).toBe(true)
  })
})
