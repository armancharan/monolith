import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { loadDesiredFromStackFile, parseStackFileContent } from "./stack-file.js"
import type { ImportSnapshot } from "@monolith/core"

describe("parseStackFileContent", () => {
  it("extracts stack name and binding declarations", () => {
    const content = `
import { stack } from "@monolith/cloudflare"

export default stack("my-stack", async (ctx) => {
  ctx.worker("api")
  ctx.d1("DB", { databaseId: "from-run" })
  ctx.kv("CACHE")
})
`
    const parsed = parseStackFileContent(content)
    expect(parsed?.stackName).toBe("my-stack")
    expect(parsed?.workerName).toBe("api")
    expect(parsed?.d1).toEqual([{ binding: "DB", databaseId: "from-run" }])
    expect(parsed?.kv).toEqual([{ binding: "CACHE" }])
  })
})

describe("loadDesiredFromStackFile", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it("merges run-file bindings with import snapshot IDs", async () => {
    const projectDir = join(tmpdir(), `monolith-stack-file-${Date.now()}`)
    tempDirs.push(projectDir)
    await mkdir(projectDir, { recursive: true })

    await writeFile(
      join(projectDir, "monolith.run.ts"),
      `export default stack("my-stack", async (ctx) => {
  ctx.worker("api")
  ctx.d1("DB")
  ctx.kv("KV")
})
`
    )

    const base: ImportSnapshot = {
      workerName: "wrangler-worker",
      contentHash: "abc",
      d1Databases: [
        { binding: "DB", databaseName: "dogfood-db", databaseId: "import-id" }
      ],
      kvNamespaces: [{ binding: "KV", id: "kv-id" }]
    }

    const desired = await loadDesiredFromStackFile(
      projectDir,
      {
        stackName: "wrangler-worker",
        stage: "dev",
        resources: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        wranglerConfigPath: "wrangler.jsonc"
      },
      base
    )

    expect(desired?.stackName).toBe("api")
    expect(desired?.resources.find((r) => r.id === "d1:DB")?.databaseId).toBe("import-id")
    expect(desired?.resources.find((r) => r.id === "kv:KV")?.namespaceId).toBe("kv-id")
  })
})
