import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { runImport } from "../../src/import.js"
import { evaluatePlan } from "../../src/plan.js"
import { runCli } from "../../src/runtime.js"
import { createFixtureProject } from "./helpers.js"

describe("plan cloud drift integration", () => {
  const tempDirs: string[] = []
  const originalToken = process.env.CLOUDFLARE_API_TOKEN

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
    vi.unstubAllGlobals()
    if (originalToken === undefined) {
      delete process.env.CLOUDFLARE_API_TOKEN
    } else {
      process.env.CLOUDFLARE_API_TOKEN = originalToken
    }
  })

  it("includes cloud drift when authed and wrangler differs from cloud", async () => {
    const projectDir = await createFixtureProject()
    tempDirs.push(projectDir)

    const importCode = await runCli(
      projectDir,
      runImport([
        join(projectDir, "wrangler.jsonc"),
        "--stage",
        "dev"
      ])
    )
    expect(importCode).toBe(0)

    process.env.CLOUDFLARE_API_TOKEN = "test-token"
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes("/workers/scripts/") && url.includes("/settings")) {
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                bindings: [
                  {
                    name: "KV",
                    type: "kv_namespace",
                    namespace_id: "cloud-kv-id-not-in-wrangler"
                  }
                ]
              }
            }),
            { status: 200 }
          )
        }
        if (url.includes("/accounts")) {
          return new Response(
            JSON.stringify({ success: true, result: [{ id: "acct-1", name: "Example" }] }),
            { status: 200 }
          )
        }
        return new Response(JSON.stringify({ success: false, errors: [{ message: "not found" }] }), {
          status: 404
        })
      })
    )

    const evaluated = await runCli(
      projectDir,
      evaluatePlan("dev", projectDir, { cloudMode: "on" })
    )

    expect(evaluated.cloud?.drift?.hasChanges).toBe(true)
    expect(
      evaluated.cloud?.drift?.changes.some(
        (change) => change.resource.id === "kv:KV" && change.type === "update"
      )
    ).toBe(true)
  })
})
