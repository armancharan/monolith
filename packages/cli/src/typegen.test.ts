import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { runTypegen, writeMonolithEnvTypes } from "./typegen.js"
import { runCli } from "./runtime.js"
import { parseWranglerConfigText } from "@monolith/cloudflare"

describe("typegen CLI", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function makeProject(): Promise<string> {
    const projectDir = join(tmpdir(), `monolith-typegen-test-${Date.now()}-${Math.random()}`)
    tempDirs.push(projectDir)

    await mkdir(join(projectDir, "src"), { recursive: true })
    await mkdir(join(projectDir, ".monolith", "state"), { recursive: true })

    await writeFile(
      join(projectDir, "wrangler.jsonc"),
      `{
  "name": "demo-worker",
  "main": "src/index.ts",
  "d1_databases": [{ "binding": "DB", "database_name": "demo-db", "database_id": "abc" }],
  "kv_namespaces": [{ "binding": "KV", "id": "def" }]
}
`
    )

    await writeFile(
      join(projectDir, ".monolith", "state", "dev.json"),
      `${JSON.stringify(
        {
          stackName: "demo-worker",
          stage: "dev",
          resources: [
            { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
            { id: "d1:DB", kind: "d1", binding: "DB", databaseId: "abc" },
            { id: "kv:KV", kind: "kv", binding: "KV", namespaceId: "def" }
          ],
          updatedAt: "2026-01-01T00:00:00.000Z",
          wranglerConfigPath: "wrangler.jsonc"
        },
        null,
        2
      )}\n`
    )

    return projectDir
  }

  it("writes monolith.env.d.ts beside worker main from import result", async () => {
    const projectDir = await makeProject()
    const result = parseWranglerConfigText(
      await readFile(join(projectDir, "wrangler.jsonc"), "utf8"),
      "wrangler.jsonc"
    )

    const relativePath = await runCli(projectDir, writeMonolithEnvTypes(projectDir, result))
    expect(relativePath).toBe("src/monolith.env.d.ts")

    const generated = await readFile(join(projectDir, relativePath), "utf8")
    expect(generated).toContain("export interface MonolithEnv {")
    expect(generated).toContain("  DB: D1Database")
    expect(generated).toContain("  KV: KVNamespace")
  })

  it("runs monolith typegen --stage from wrangler config", async () => {
    const projectDir = await makeProject()
    const originalCwd = process.cwd()

    try {
      process.chdir(projectDir)
      const code = await runCli(projectDir, runTypegen(["--stage", "dev"]))
      expect(code).toBe(0)

      const generated = await readFile(join(projectDir, "src/monolith.env.d.ts"), "utf8")
      expect(generated).toContain("  DB: D1Database")
    } finally {
      process.chdir(originalCwd)
    }
  })
})
