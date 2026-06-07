import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CloudflareClient } from "@monolith/cloudflare"
import { runImport } from "../../src/import.js"
import { evaluatePlan } from "../../src/plan.js"
import { createFixtureProject } from "./helpers.js"

describe("plan cloud drift integration", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
    vi.restoreAllMocks()
  })

  it("includes cloud drift when authed and wrangler differs from cloud", async () => {
    const projectDir = await createFixtureProject()
    tempDirs.push(projectDir)

    const importCode = await runImport([
      join(projectDir, "wrangler.jsonc"),
      "--stage",
      "dev"
    ])
    expect(importCode).toBe(0)

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
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

    vi.spyOn(CloudflareClient, "create").mockResolvedValue({
      ok: true,
      value: new CloudflareClient({
        token: "test-token",
        fetchImpl: fetchImpl as typeof fetch
      })
    })

    const evaluated = await evaluatePlan("dev", projectDir, { cloudMode: "on" })
    expect(evaluated.ok).toBe(true)
    if (!evaluated.ok) {
      return
    }

    expect(evaluated.value.cloud?.drift?.hasChanges).toBe(true)
    expect(
      evaluated.value.cloud?.drift?.changes.some(
        (change) => change.resource.id === "kv:KV" && change.type === "update"
      )
    ).toBe(true)
  })
})
