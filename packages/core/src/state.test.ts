import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { StateStore, makeStateStoreLayer } from "./services/StateStore.js"

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

const runWithStore = <A, E>(
  projectDir: string,
  program: Effect.Effect<A, E, StateStore>
) => Effect.runPromise(program.pipe(Effect.provide(makeStateStoreLayer(projectDir))))

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

    await runWithStore(
      projectDir,
      Effect.gen(function* () {
        const store = yield* StateStore
        yield* store.initStateFromImport(importPath, "dev")
        const loaded = yield* store.loadState("dev")
        expect(loaded.stackName).toBe("demo-worker")
        expect(loaded.stage).toBe("dev")
        expect(loaded.importHash).toBe("abc123")
        expect(loaded.resources).toHaveLength(3)
      })
    )

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

    await runWithStore(
      projectDir,
      Effect.gen(function* () {
        const store = yield* StateStore
        yield* store.saveState("dev", devState)
        yield* store.saveState("prod", prodState)

        const devLoad = yield* store.loadState("dev")
        const prodLoad = yield* store.loadState("prod")
        expect(devLoad.stage).toBe("dev")
        expect(prodLoad.stage).toBe("prod")
        expect(devLoad.updatedAt).not.toBe(prodLoad.updatedAt)
      })
    )
  })

  it("clearState removes the stage file", async () => {
    projectDir = await mkdtemp(join(tmpdir(), "monolith-state-"))
    const state = {
      stackName: "demo-worker",
      stage: "dev",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }],
      updatedAt: "2026-01-01T00:00:00.000Z"
    }

    await expect(
      runWithStore(
        projectDir,
        Effect.gen(function* () {
          const store = yield* StateStore
          yield* store.saveState("dev", state)
          yield* store.clearState("dev")
          return yield* store.loadState("dev")
        })
      )
    ).rejects.toMatchObject({
      _tag: "StateError",
      message: expect.stringContaining("State file not found")
    })
  })
})
