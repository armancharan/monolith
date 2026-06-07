import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runImport } from "../../src/import.js"
import { evaluatePlan } from "../../src/plan.js"
import { runCli } from "../../src/runtime.js"
import { createFixtureProject } from "./helpers.js"

describe("plan flow integration", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it("detects wrangler mutation as plan changes", async () => {
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

    const wranglerPath = join(projectDir, "wrangler.jsonc")
    const wranglerText = await readFile(wranglerPath, "utf8")
    const mutated = wranglerText.replace(
      "58e35e39e0ba4816b1d5d666898b55be",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    )
    await writeFile(wranglerPath, mutated)

    const evaluated = await runCli(projectDir, evaluatePlan("dev", projectDir))

    expect(evaluated.pending.hasChanges).toBe(true)
    expect(evaluated.pending.changes.some((change) => change.resource.id === "kv:KV")).toBe(true)
  })
})
