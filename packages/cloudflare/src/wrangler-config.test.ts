import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { snapshotToWranglerConfigObject, writePreviewWranglerConfig } from "./wrangler-config.js"

describe("snapshotToWranglerConfigObject", () => {
  it("builds wrangler config from import snapshot", () => {
    const config = snapshotToWranglerConfigObject({
      workerName: "demo-worker",
      contentHash: "abc123",
      main: "src/index.ts",
      compatibilityDate: "2025-03-01",
      d1Databases: [
        {
          binding: "DB",
          databaseName: "demo-db",
          databaseId: "11111111-1111-1111-1111-111111111111"
        }
      ],
      kvNamespaces: [{ binding: "KV", id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]
    })

    expect(config).toEqual({
      name: "demo-worker",
      main: "src/index.ts",
      compatibility_date: "2025-03-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: "demo-db",
          database_id: "11111111-1111-1111-1111-111111111111"
        }
      ],
      kv_namespaces: [{ binding: "KV", id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]
    })
  })
})

describe("writePreviewWranglerConfig", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it("writes temp config with suffixed worker name", async () => {
    const projectDir = join(tmpdir(), `monolith-preview-config-${Date.now()}`)
    tempDirs.push(projectDir)
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      join(projectDir, "wrangler.jsonc"),
      `{ "name": "demo-worker", "main": "src/index.ts" }\n`
    )

    const configPath = await writePreviewWranglerConfig("wrangler.jsonc", "pr-5", projectDir)
    expect(configPath).toBe(".monolith/wrangler.pr-5.jsonc")

    const written = JSON.parse(
      await readFile(join(projectDir, ".monolith", "wrangler.pr-5.jsonc"), "utf8")
    )
    expect(written.name).toBe("demo-worker-pr-5")
  })
})
