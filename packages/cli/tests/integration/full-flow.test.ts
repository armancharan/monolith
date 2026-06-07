import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import * as cloudflare from "@monolith/cloudflare"
import { CloudflareAuthError } from "@monolith/cloudflare"
import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { runDeploy, type RunWranglerDeploy } from "../../src/deploy.js"
import { runImport } from "../../src/import.js"
import { evaluatePlan } from "../../src/plan.js"
import { runCli } from "../../src/runtime.js"
import { createFixtureProject, readState } from "./helpers.js"

describe("full flow integration", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it("runs import → clean plan → mock deploy and records workerUrl", async () => {
    const cloudSpy = vi.spyOn(cloudflare, "readActualStack").mockReturnValue(
      Effect.fail(new CloudflareAuthError({ message: "No Cloudflare credentials found" }))
    )

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

    const planEval = await runCli(projectDir, evaluatePlan("dev", projectDir))
    expect(planEval.pending.hasChanges).toBe(false)

    const mockDeploy: RunWranglerDeploy = async () => ({
      exitCode: 0,
      output: "Deployed https://monolith-m1-dogfood.example.workers.dev\n"
    })

    const deployCode = await runCli(
      projectDir,
      runDeploy(["--stage", "dev"], {
        projectDir,
        runWrangler: mockDeploy
      })
    )
    expect(deployCode).toBe(0)

    const state = await readState(projectDir, "dev")
    expect(state.workerUrl).toBe("https://monolith-m1-dogfood.example.workers.dev")
    expect(state.deployedAt).toBeTypeOf("string")

    cloudSpy.mockRestore()
  })
})
