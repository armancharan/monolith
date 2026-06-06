import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveCloudflareAuth } from "./auth.js"

describe("resolveCloudflareAuth", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CLOUDFLARE_API_TOKEN
    delete process.env.WRANGLER_HOME
    delete process.env.XDG_CONFIG_HOME
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("prefers CLOUDFLARE_API_TOKEN over wrangler config", async () => {
    process.env.CLOUDFLARE_API_TOKEN = "cf-test-token"

    const result = await resolveCloudflareAuth()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.token).toBe("cf-test-token")
      expect(result.value.source).toBe("env:api_token")
    }
  })

  it("reads oauth_token from wrangler config directory", async () => {
    const configRoot = await mkdtemp(join(tmpdir(), "monolith-auth-"))
    const configPath = join(configRoot, "config", "default.toml")
    await mkdir(join(configRoot, "config"), { recursive: true })
    await writeFile(
      configPath,
      'oauth_token = "oauth-from-file"\nexpiration_time = "3021-12-31T23:59:59+00:00"\n',
      "utf8"
    )

    process.env.WRANGLER_HOME = configRoot

    const result = await resolveCloudflareAuth()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.token).toBe("oauth-from-file")
      expect(result.value.source).toBe("global:wrangler")
      expect(result.value.configPath).toBe(configPath)
    }

    await rm(configRoot, { recursive: true, force: true })
  })

  it("returns auth error when no credentials exist", async () => {
    const result = await resolveCloudflareAuth({ configPaths: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain("No Cloudflare credentials found")
    }
  })
})
