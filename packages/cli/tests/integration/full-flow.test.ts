import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runDeploy, type RunWranglerDeploy } from "../../src/deploy.js"
import { runImport } from "../../src/import.js"
import { evaluatePlan } from "../../src/plan.js"
import { createFixtureProject, readState } from "./helpers.js"

describe("full flow integration", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it("runs import → clean plan → mock deploy and records workerUrl", async () => {
    const projectDir = await createFixtureProject()
    tempDirs.push(projectDir)

    const importCode = await runImport([
      join(projectDir, "wrangler.jsonc"),
      "--stage",
      "dev"
    ])
    expect(importCode).toBe(0)

    const planEval = await evaluatePlan("dev", projectDir)
    expect(planEval.ok).toBe(true)
    if (!planEval.ok) {
      return
    }
    expect(planEval.value.plan.hasChanges).toBe(false)

    const mockDeploy: RunWranglerDeploy = async () => ({
      exitCode: 0,
      output: "Deployed https://monolith-m1-dogfood.example.workers.dev\n"
    })

    const deployCode = await runDeploy(["--stage", "dev"], {
      projectDir,
      runWrangler: mockDeploy
    })
    expect(deployCode).toBe(0)

    const state = await readState(projectDir, "dev")
    expect(state.workerUrl).toBe("https://monolith-m1-dogfood.example.workers.dev")
    expect(state.deployedAt).toBeTypeOf("string")
  })
})
