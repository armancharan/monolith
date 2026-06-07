import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import {
  parseWorkerUrlFromWranglerOutput,
  runDeploy,
  type RunWranglerDeploy
} from "./deploy.js"

describe("parseWorkerUrlFromWranglerOutput", () => {
  it("extracts the last workers.dev URL from wrangler output", () => {
    const output = `
Uploaded monolith-m1-dogfood (1.23 sec)
  https://preview.example.workers.dev
  https://monolith-m1-dogfood.armancharan.workers.dev
Current Version ID: abc123
`
    expect(parseWorkerUrlFromWranglerOutput(output)).toBe(
      "https://monolith-m1-dogfood.armancharan.workers.dev"
    )
  })

  it("returns undefined when no workers.dev URL is present", () => {
    expect(parseWorkerUrlFromWranglerOutput("Deploy finished without URL")).toBeUndefined()
  })
})

describe("runDeploy", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function makeProject(stage: string, state: Record<string, unknown>): Promise<string> {
    const projectDir = join(tmpdir(), `monolith-deploy-test-${Date.now()}-${Math.random()}`)
    tempDirs.push(projectDir)
    await mkdir(join(projectDir, ".monolith", "state"), { recursive: true })
    await writeFile(join(projectDir, ".monolith", "state", `${stage}.json`), `${JSON.stringify(state, null, 2)}\n`)
    await writeFile(
      join(projectDir, "wrangler.jsonc"),
      `{ "name": "demo-worker", "main": "src/index.ts" }\n`
    )
    return projectDir
  }

  it("updates state with deploy metadata after successful wrangler deploy", async () => {
    const projectDir = await makeProject("dev", {
      stackName: "demo-worker",
      stage: "dev",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc"
    })

    const mockDeploy: RunWranglerDeploy = async (cwd, configPath) => {
      expect(cwd).toBe(projectDir)
      expect(configPath).toBe("wrangler.jsonc")
      return {
        exitCode: 0,
        output: "Deployed https://demo-worker.example.workers.dev\n"
      }
    }

    const code = await runDeploy(["--stage", "dev", "--auto-approve"], {
      projectDir,
      runWrangler: mockDeploy
    })

    expect(code).toBe(0)

    const saved = JSON.parse(await readFile(join(projectDir, ".monolith", "state", "dev.json"), "utf8"))
    expect(saved.deployedAt).toBeTypeOf("string")
    expect(saved.workerUrl).toBe("https://demo-worker.example.workers.dev")
    expect(saved.updatedAt).toBe(saved.deployedAt)
  })

  it("returns wrangler exit code on deploy failure", async () => {
    const projectDir = await makeProject("dev", {
      stackName: "demo-worker",
      stage: "dev",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc"
    })

    const mockDeploy: RunWranglerDeploy = async () => ({
      exitCode: 1,
      output: "Authentication error\n"
    })

    const code = await runDeploy(["--stage", "dev", "--auto-approve"], {
      projectDir,
      runWrangler: mockDeploy
    })

    expect(code).toBe(1)

    const saved = JSON.parse(await readFile(join(projectDir, ".monolith", "state", "dev.json"), "utf8"))
    expect(saved.deployedAt).toBeUndefined()
    expect(saved.workerUrl).toBeUndefined()
  })

  it("blocks deploy when plan has pending changes without --auto-approve", async () => {
    const projectDir = await makeProject("dev", {
      stackName: "demo-worker",
      stage: "dev",
      resources: [
        { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
        { id: "kv:KV", kind: "kv", binding: "KV", namespaceId: "old-id" }
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc"
    })

    await writeFile(
      join(projectDir, "wrangler.jsonc"),
      `{
  "name": "demo-worker",
  "main": "src/index.ts",
  "kv_namespaces": [{ "binding": "KV", "id": "new-id" }]
}
`
    )

    const mockDeploy: RunWranglerDeploy = async () => ({
      exitCode: 0,
      output: "should not run\n"
    })

    const code = await runDeploy(["--stage", "dev"], {
      projectDir,
      runWrangler: mockDeploy
    })

    expect(code).toBe(1)
  })

  it("allows deploy when plan is clean", async () => {
    const projectDir = await makeProject("dev", {
      stackName: "demo-worker",
      stage: "dev",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc"
    })

    const mockDeploy: RunWranglerDeploy = async () => ({
      exitCode: 0,
      output: "Deployed https://demo-worker.example.workers.dev\n"
    })

    const code = await runDeploy(["--stage", "dev"], {
      projectDir,
      runWrangler: mockDeploy
    })

    expect(code).toBe(0)
  })

  it("uses preview worker suffix and temp config for pr-* stages", async () => {
    const projectDir = await makeProject("pr-123", {
      stackName: "demo-worker",
      stage: "pr-123",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc"
    })

    const mockDeploy: RunWranglerDeploy = async (cwd, configPath) => {
      expect(cwd).toBe(projectDir)
      expect(configPath).toBe(".monolith/wrangler.pr-123.jsonc")
      return {
        exitCode: 0,
        output: "Deployed https://demo-worker-pr-123.example.workers.dev\n"
      }
    }

    const code = await runDeploy(["--stage", "pr-123", "--auto-approve"], {
      projectDir,
      runWrangler: mockDeploy
    })

    expect(code).toBe(0)

    const previewConfig = JSON.parse(
      await readFile(join(projectDir, ".monolith", "wrangler.pr-123.jsonc"), "utf8")
    )
    expect(previewConfig.name).toBe("demo-worker-pr-123")
  })
})
