import { Effect } from "effect"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
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
})
