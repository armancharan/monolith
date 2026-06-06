import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { initStateFromImport, loadState, saveState } from "./state.js"

const importSnapshot = {
  workerName: "demo-worker",
  contentHash: "abc123",
  d1Databases: [
    {
      binding: "DB",
      databaseName: "demo-db",
      databaseId: "11111111-1111-1111-1111-111111111111"
    }
  ],
  kvNamespaces: [{ binding: "KV", id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
  queues: [],
  r2Buckets: []
}

describe("state engine", () => {
  let projectDir: string

  afterEach(async () => {
    if (projectDir) {
      await rm(projectDir, { recursive: true, force: true })
    }
  })

  it("initStateFromImport writes loadable stage state", async () => {
    projectDir = await mkdtemp(join(tmpdir(), "monolith-state-"))
    const importPath = ".monolith/import/abc123.json"
    const importFile = join(projectDir, importPath)
    await mkdir(join(projectDir, ".monolith/import"), { recursive: true })
    await writeFile(importFile, `${JSON.stringify(importSnapshot, null, 2)}\n`, "utf8")

    const initResult = await initStateFromImport(importPath, "dev", projectDir)
    expect(initResult.ok).toBe(true)

    const loadResult = await loadState("dev", projectDir)
    expect(loadResult.ok).toBe(true)
    if (loadResult.ok) {
      expect(loadResult.value.stackName).toBe("demo-worker")
      expect(loadResult.value.stage).toBe("dev")
      expect(loadResult.value.importHash).toBe("abc123")
      expect(loadResult.value.resources).toHaveLength(3)
    }

    const raw = await readFile(join(projectDir, ".monolith/state/dev.json"), "utf8")
    expect(raw).toContain('"stackName": "demo-worker"')
  })

  it("isolates state per stage", async () => {
    projectDir = await mkdtemp(join(tmpdir(), "monolith-state-"))
    const devState = {
      stackName: "demo-worker",
      stage: "dev",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }],
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
    const prodState = {
      ...devState,
      stage: "prod",
      updatedAt: "2026-01-02T00:00:00.000Z"
    }

    const devSave = await saveState("dev", devState, projectDir)
    const prodSave = await saveState("prod", prodState, projectDir)
    expect(devSave.ok).toBe(true)
    expect(prodSave.ok).toBe(true)

    const devLoad = await loadState("dev", projectDir)
    const prodLoad = await loadState("prod", projectDir)
    expect(devLoad.ok).toBe(true)
    expect(prodLoad.ok).toBe(true)
    if (devLoad.ok && prodLoad.ok) {
      expect(devLoad.value.stage).toBe("dev")
      expect(prodLoad.value.stage).toBe("prod")
      expect(devLoad.value.updatedAt).not.toBe(prodLoad.value.updatedAt)
    }
  })
})
