import { CloudflareClient, resolveCloudflareAuth } from "@monolith/cloudflare"
import { describe, expect, it } from "vitest"

const LIVE_ENABLED = process.env.MONOLITH_LIVE_TESTS === "1"

async function hasCloudflareAuth(): Promise<boolean> {
  const auth = await resolveCloudflareAuth()
  return auth.ok
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

    const clientResult = await CloudflareClient.create()
    expect(clientResult.ok).toBe(true)
    if (!clientResult.ok) {
      return
    }

    const whoami = await clientResult.value.whoami()
    expect(whoami.ok).toBe(true)
    if (whoami.ok) {
      expect(whoami.value.user.id).toBeTruthy()
      expect(whoami.value.accounts.length).toBeGreaterThan(0)
    }
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
