import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveTestUrl, runHttpSmokeCheck, runTest } from "./test.js"
import type { RunWranglerDeploy } from "./deploy.js"
import type { RunWranglerDelete } from "./destroy.js"
import type { HttpFetch } from "./test.js"

describe("resolveTestUrl", () => {
  it("prefers MONOLITH_TEST_URL over state workerUrl", () => {
    expect(resolveTestUrl("https://state.example.workers.dev", "https://env.example.test")).toBe(
      "https://env.example.test"
    )
  })

  it("falls back to state workerUrl", () => {
    expect(resolveTestUrl("https://state.example.workers.dev", undefined)).toBe(
      "https://state.example.workers.dev"
    )
  })
})

describe("runHttpSmokeCheck", () => {
  it("passes on 2xx status", async () => {
    const fetchImpl: HttpFetch = async () => ({ status: 200, body: "ok" })
    const result = await runHttpSmokeCheck("https://example.test", fetchImpl)
    expect(result.ok).toBe(true)
  })

  it("fails on non-2xx status", async () => {
    const fetchImpl: HttpFetch = async () => ({ status: 500, body: "error" })
    const result = await runHttpSmokeCheck("https://example.test", fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("500")
    }
  })
})

describe("runTest", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
    vi.unstubAllEnvs()
  })

  async function makeProject(state: Record<string, unknown>): Promise<string> {
    const projectDir = join(tmpdir(), `monolith-test-harness-${Date.now()}-${Math.random()}`)
    tempDirs.push(projectDir)
    await mkdir(join(projectDir, ".monolith", "state"), { recursive: true })
    await mkdir(join(projectDir, ".monolith", "test"), { recursive: true })
    await writeFile(join(projectDir, ".monolith", "state", "dev.json"), `${JSON.stringify(state, null, 2)}\n`)
    await writeFile(
      join(projectDir, "wrangler.jsonc"),
      `{ "name": "demo-worker", "main": "src/index.ts" }\n`
    )
    return projectDir
  }

  it("deploys, runs route assertions, and optionally destroys", async () => {
    const projectDir = await makeProject({
      stackName: "demo-worker",
      stage: "dev",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc",
      workerUrl: "https://demo-worker.example.workers.dev"
    })

    await writeFile(
      join(projectDir, ".monolith", "test", "assertions.json"),
      `${JSON.stringify({
        routes: [{ path: "/health", expectStatus: 200, expectBodyContains: "ok" }]
      }, null, 2)}\n`
    )

    const deployCalls: string[] = []
    const deleteCalls: string[] = []

    const mockDeploy: RunWranglerDeploy = async () => {
      deployCalls.push("deploy")
      return {
        exitCode: 0,
        output: "Deployed https://demo-worker.example.workers.dev\n"
      }
    }

    const mockDelete: RunWranglerDelete = async () => {
      deleteCalls.push("delete")
      return { exitCode: 0, output: "deleted\n" }
    }

    const mockFetch: HttpFetch = async (url) => {
      expect(url).toBe("https://demo-worker.example.workers.dev/health")
      return { status: 200, body: "ok" }
    }

    const code = await runTest(["--stage", "dev", "--destroy-after"], {
      projectDir,
      runWranglerDeploy: mockDeploy,
      runWranglerDelete: mockDelete,
      httpFetch: mockFetch
    })

    expect(code).toBe(0)
    expect(deployCalls).toEqual(["deploy"])
    expect(deleteCalls).toEqual(["delete"])
  })

  it("fails when route assertion returns non-2xx", async () => {
    const projectDir = await makeProject({
      stackName: "demo-worker",
      stage: "dev",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc",
      workerUrl: "https://demo-worker.example.workers.dev"
    })

    await writeFile(
      join(projectDir, ".monolith", "test", "assertions.json"),
      `${JSON.stringify({ routes: [{ path: "/health", expectStatus: 200 }] }, null, 2)}\n`
    )

    const mockDeploy: RunWranglerDeploy = async () => ({
      exitCode: 0,
      output: "Deployed https://demo-worker.example.workers.dev\n"
    })

    const mockFetch: HttpFetch = async () => ({ status: 503, body: "down" })

    const code = await runTest(["--stage", "dev"], {
      projectDir,
      runWranglerDeploy: mockDeploy,
      httpFetch: mockFetch
    })

    expect(code).toBe(1)
  })
})
