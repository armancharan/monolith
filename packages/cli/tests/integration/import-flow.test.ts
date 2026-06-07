import { access, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { constants } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { runImport } from "../../src/import.js"
import { runCli } from "../../src/runtime.js"
import { createFixtureProject, listImportSnapshots } from "./helpers.js"

describe("import flow integration", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it("imports dogfood wrangler fixture into snapshot, state, and typegen", async () => {
    const projectDir = await createFixtureProject()
    tempDirs.push(projectDir)

    const code = await runCli(
      projectDir,
      runImport([
        join(projectDir, "wrangler.jsonc"),
        "--stage",
        "dev"
      ])
    )

    expect(code).toBe(0)

    const snapshots = await listImportSnapshots(projectDir)
    expect(snapshots.length).toBe(1)

    await access(join(projectDir, ".monolith", "state", "dev.json"), constants.F_OK)
    await access(join(projectDir, "monolith.run.ts"), constants.F_OK)
    await access(join(projectDir, "src", "monolith.env.d.ts"), constants.F_OK)

    const envTypes = await readFile(join(projectDir, "src", "monolith.env.d.ts"), "utf8")
    expect(envTypes).toContain("DB: D1Database")
    expect(envTypes).toContain("KV: KVNamespace")
  })
})
