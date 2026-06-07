import { Effect } from "effect"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it, vi } from "vitest"
import * as deployModule from "@monolith/cli/deploy"
import { MonolithEffect, MonolithEffectLive } from "./index.js"

describe("MonolithEffectLive", () => {
  it("plans stage state as an Effect", async () => {
    const projectDir = join(tmpdir(), `monolith-effect-${Date.now()}`)
    await mkdir(join(projectDir, ".monolith", "state"), { recursive: true })
    await writeFile(
      join(projectDir, ".monolith", "state", "dev.json"),
      `${JSON.stringify({
        stackName: "demo",
        stage: "dev",
        resources: [{ id: "worker:demo", kind: "worker", name: "demo" }],
        updatedAt: "2026-01-01T00:00:00.000Z"
      }, null, 2)}\n`
    )

    const program = Effect.gen(function* () {
      const monolith = yield* MonolithEffect
      return yield* monolith.plan("dev", projectDir)
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(MonolithEffectLive)))
    expect(result.stage).toBe("dev")
    expect(result.hasChanges).toBe(false)
  })

  it("deploys stage via shared CLI deploy logic", async () => {
    const projectDir = join(tmpdir(), `monolith-effect-deploy-${Date.now()}`)
    await mkdir(join(projectDir, ".monolith", "state"), { recursive: true })
    await writeFile(
      join(projectDir, "wrangler.jsonc"),
      `{ "name": "demo", "main": "src/index.ts" }\n`
    )
    await writeFile(
      join(projectDir, ".monolith", "state", "dev.json"),
      `${JSON.stringify({
        stackName: "demo",
        stage: "dev",
        resources: [{ id: "worker:demo", kind: "worker", name: "demo" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
        wranglerConfigPath: "wrangler.jsonc"
      }, null, 2)}\n`
    )

    const executeDeploy = vi.spyOn(deployModule, "executeDeploy").mockResolvedValue({
      exitCode: 0,
      workerUrl: "https://demo.example.workers.dev",
      deployedAt: "2026-06-07T00:00:00.000Z"
    })

    const program = Effect.gen(function* () {
      const monolith = yield* MonolithEffect
      return yield* monolith.deploy("dev", projectDir)
    })

    const result = await Effect.runPromise(program.pipe(Effect.provide(MonolithEffectLive)))
    expect(result.stage).toBe("dev")
    expect(result.workerUrl).toBe("https://demo.example.workers.dev")
    expect(executeDeploy).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "dev", projectDir, autoApprove: true })
    )
  })
})
