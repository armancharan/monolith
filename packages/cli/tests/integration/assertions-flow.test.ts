import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { evaluateRouteAssertions, normalizeAssertionRoutes } from "../../src/assertions.js"
import type { RunWranglerDeploy } from "../../src/deploy.js"
import { runImport } from "../../src/import.js"
import { runCli } from "../../src/runtime.js"
import { runTest } from "../../src/test.js"
import { createFixtureProject, readState } from "./helpers.js"

describe("assertions integration", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
    vi.restoreAllMocks()
  })

  it("evaluates route assertions end-to-end in test harness", async () => {
    const projectDir = await createFixtureProject()
    tempDirs.push(projectDir)

    const importCode = await runCli(
      projectDir,
      runImport([join(projectDir, "wrangler.jsonc"), "--stage", "dev"])
    )
    expect(importCode).toBe(0)

    await mkdir(join(projectDir, ".monolith", "test"), { recursive: true })
    await writeFile(
      join(projectDir, ".monolith", "test", "assertions.json"),
      `${JSON.stringify({
        version: 1,
        routes: [
          { path: "/api/health", expectStatus: 200, expectBodyContains: "healthy" },
          { path: "/", expectStatus: 200 }
        ]
      }, null, 2)}\n`
    )

    const assertionFile = JSON.parse(
      await readFile(join(projectDir, ".monolith", "test", "assertions.json"), "utf8")
    )
    const routes = normalizeAssertionRoutes(assertionFile)
    expect(routes).toHaveLength(2)

    const fetchCalls: string[] = []
    const mockFetch = async (url: string) => {
      fetchCalls.push(url)
      if (url.endsWith("/api/health")) {
        return { status: 200, body: '{"status":"healthy"}' }
      }
      return { status: 200, body: "ok" }
    }

    const directResult = await evaluateRouteAssertions(
      "https://demo.example.workers.dev",
      routes,
      mockFetch
    )
    expect(directResult.ok).toBe(true)
    expect(fetchCalls).toHaveLength(2)

    const mockDeploy: RunWranglerDeploy = async () => ({
      exitCode: 0,
      output: "Deployed https://monolith-m1-dogfood.example.workers.dev\n"
    })

    const testCode = await runCli(
      projectDir,
      runTest(["--stage", "dev"], {
        projectDir,
        runWranglerDeploy: mockDeploy,
        httpFetch: mockFetch
      })
    )

    expect(testCode).toBe(0)

    const state = await readState(projectDir, "dev")
    expect(state.workerUrl).toBe("https://monolith-m1-dogfood.example.workers.dev")
    expect(fetchCalls.length).toBeGreaterThanOrEqual(2)
  })
})
