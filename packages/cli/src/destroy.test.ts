import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import {
  bindingResourceSummary,
  findWorkerResource,
  resolveDestroyWorkerName,
  runDestroy,
  type RunWranglerDelete
} from "./destroy.js"

describe("findWorkerResource", () => {
  it("returns the worker resource from state resources", () => {
    const worker = findWorkerResource([
      { id: "worker:demo", kind: "worker", name: "demo" },
      { id: "kv:KV", kind: "kv", binding: "KV" }
    ])
    expect(worker?.name).toBe("demo")
  })
})

describe("resolveDestroyWorkerName", () => {
  it("suffixes preview worker names for pr-* stages", () => {
    expect(resolveDestroyWorkerName("demo-worker", "pr-99")).toBe("demo-worker-pr-99")
    expect(resolveDestroyWorkerName("demo-worker", "dev")).toBe("demo-worker")
  })
})

describe("bindingResourceSummary", () => {
  it("lists non-worker bindings with safety labels", () => {
    const lines = bindingResourceSummary([
      { id: "worker:demo", kind: "worker", name: "demo" },
      { id: "d1:DB", kind: "d1", binding: "DB", name: "demo-db" },
      { id: "kv:KV", kind: "kv", binding: "KV" }
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("D1")
    expect(lines[0]).toContain("NOT deleted")
  })
})

describe("runDestroy", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function makeProject(state: Record<string, unknown>): Promise<string> {
    const projectDir = join(tmpdir(), `monolith-destroy-test-${Date.now()}-${Math.random()}`)
    tempDirs.push(projectDir)
    await mkdir(join(projectDir, ".monolith", "state"), { recursive: true })
    await writeFile(join(projectDir, ".monolith", "state", "dev.json"), `${JSON.stringify(state, null, 2)}\n`)
    await writeFile(
      join(projectDir, "wrangler.jsonc"),
      `{ "name": "demo-worker", "main": "src/index.ts" }\n`
    )
    return projectDir
  }

  it("requires --auto-approve before deleting", async () => {
    const projectDir = await makeProject({
      stackName: "demo-worker",
      stage: "dev",
      resources: [
        { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
        { id: "kv:KV", kind: "kv", binding: "KV", namespaceId: "abc" }
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc"
    })

    const mockDelete: RunWranglerDelete = async () => ({
      exitCode: 0,
      output: "deleted\n"
    })

    const code = await runDestroy(["--stage", "dev"], {
      projectDir,
      runWranglerDelete: mockDelete
    })

    expect(code).toBe(1)
    await expect(readFile(join(projectDir, ".monolith", "state", "dev.json"), "utf8")).resolves.toBeDefined()
  })

  it("deletes worker via wrangler and clears state with --auto-approve", async () => {
    const projectDir = await makeProject({
      stackName: "demo-worker",
      stage: "dev",
      resources: [
        { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
        { id: "d1:DB", kind: "d1", binding: "DB", databaseId: "db-id" }
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc"
    })

    const mockDelete: RunWranglerDelete = async (cwd, workerName, configPath) => {
      expect(cwd).toBe(projectDir)
      expect(workerName).toBe("demo-worker")
      expect(configPath).toBe("wrangler.jsonc")
      return { exitCode: 0, output: "Deleted script demo-worker\n" }
    }

    const code = await runDestroy(["--stage", "dev", "--auto-approve"], {
      projectDir,
      runWranglerDelete: mockDelete
    })

    expect(code).toBe(0)
    await expect(readFile(join(projectDir, ".monolith", "state", "dev.json"), "utf8")).rejects.toThrow()
  })

  it("returns wrangler exit code on delete failure", async () => {
    const projectDir = await makeProject({
      stackName: "demo-worker",
      stage: "dev",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc"
    })

    const mockDelete: RunWranglerDelete = async () => ({
      exitCode: 1,
      output: "not found\n"
    })

    const code = await runDestroy(["--stage", "dev", "--auto-approve"], {
      projectDir,
      runWranglerDelete: mockDelete
    })

    expect(code).toBe(1)
    await expect(readFile(join(projectDir, ".monolith", "state", "dev.json"), "utf8")).resolves.toBeDefined()
  })

  it("clears state when no worker resource exists", async () => {
    const projectDir = await makeProject({
      stackName: "demo-worker",
      stage: "dev",
      resources: [{ id: "kv:KV", kind: "kv", binding: "KV", namespaceId: "abc" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
      wranglerConfigPath: "wrangler.jsonc"
    })

    const mockDelete: RunWranglerDelete = async () => {
      throw new Error("should not call wrangler delete")
    }

    const code = await runDestroy(["--stage", "dev", "--auto-approve"], {
      projectDir,
      runWranglerDelete: mockDelete
    })

    expect(code).toBe(0)
    await expect(readFile(join(projectDir, ".monolith", "state", "dev.json"), "utf8")).rejects.toThrow()
  })
})
