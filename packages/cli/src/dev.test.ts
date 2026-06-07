import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it, vi } from "vitest"
import { resolveDevConfigPath, runDev } from "./dev.js"

async function createProjectWithState(): Promise<string> {
  const projectDir = join(tmpdir(), `monolith-dev-${Date.now()}-${Math.random()}`)
  await mkdir(join(projectDir, "src"), { recursive: true })
  await mkdir(join(projectDir, ".monolith", "state"), { recursive: true })
  await mkdir(join(projectDir, ".monolith", "import"), { recursive: true })
  await writeFile(join(projectDir, "src", "index.ts"), `export default { fetch() { return new Response("ok") } }\n`)
  await writeFile(
    join(projectDir, "wrangler.jsonc"),
    `${JSON.stringify({
      name: "demo-worker",
      main: "src/index.ts",
      compatibility_date: "2025-03-01"
    }, null, 2)}\n`
  )
  await writeFile(
    join(projectDir, ".monolith", "state", "dev.json"),
    `${JSON.stringify({
      stackName: "demo-worker",
      stage: "dev",
      wranglerConfigPath: "wrangler.jsonc",
      updatedAt: "2026-01-01T00:00:00.000Z",
      resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }]
    }, null, 2)}\n`
  )
  return projectDir
}

describe("resolveDevConfigPath", () => {
  it("uses existing wrangler config from state", async () => {
    const projectDir = await createProjectWithState()
    const result = await resolveDevConfigPath("dev", projectDir)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.configPath).toBe("wrangler.jsonc")
      expect(result.temp).toBe(false)
    }
  })

  it("writes temp wrangler config from import snapshot when project config is missing", async () => {
    const projectDir = await createProjectWithState()
    await writeFile(
      join(projectDir, ".monolith", "import", "abc123.json"),
      `${JSON.stringify({
        workerName: "demo-worker",
        contentHash: "abc123",
        main: "src/index.ts",
        compatibilityDate: "2025-03-01"
      }, null, 2)}\n`
    )
    await writeFile(
      join(projectDir, ".monolith", "state", "dev.json"),
      `${JSON.stringify({
        stackName: "demo-worker",
        stage: "dev",
        importSnapshotPath: ".monolith/import/abc123.json",
        updatedAt: "2026-01-01T00:00:00.000Z",
        resources: [{ id: "worker:demo-worker", kind: "worker", name: "demo-worker" }]
      }, null, 2)}\n`
    )

    const { unlink } = await import("node:fs/promises")
    await unlink(join(projectDir, "wrangler.jsonc"))

    const result = await resolveDevConfigPath("dev", projectDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.temp).toBe(true)
      expect(result.configPath).toBe(".monolith/wrangler.dev.jsonc")
    }
  })
})

describe("runDev", () => {
  it("invokes wrangler dev with resolved config path", async () => {
    const projectDir = await createProjectWithState()
    const runWrangler = vi.fn(async () => ({ exitCode: 0 }))

    const code = await runDev(["--stage", "dev"], {
      projectDir,
      runWrangler
    })

    expect(code).toBe(0)
    expect(runWrangler).toHaveBeenCalledWith(projectDir, "wrangler.jsonc")
  })
})
