import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import {
  ensurePlaceholderResources,
  isPlaceholderId,
  parseD1DatabaseIdFromOutput,
  parseKvNamespaceIdFromOutput,
  type RunWranglerCommand
} from "./ensure-resources.js"
import { runCli } from "./runtime.js"

describe("isPlaceholderId", () => {
  it("detects REPLACE_ prefixes and empty values", () => {
    expect(isPlaceholderId("REPLACE_WITH_D1_DATABASE_ID")).toBe(true)
    expect(isPlaceholderId("")).toBe(true)
    expect(isPlaceholderId(undefined)).toBe(true)
    expect(isPlaceholderId("70b33c81-e63d-44c1-a414-b48aa3e032ec")).toBe(false)
  })
})

describe("wrangler output parsers", () => {
  it("parses D1 database_id from wrangler output", () => {
    const output = `
Created your new D1 database.
database_id = "11111111-1111-1111-1111-111111111111"
`
    expect(parseD1DatabaseIdFromOutput(output)).toBe("11111111-1111-1111-1111-111111111111")
  })

  it("parses KV namespace id from wrangler output", () => {
    const output = `
Add the following to your configuration file:
id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
`
    expect(parseKvNamespaceIdFromOutput(output)).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  })
})

describe("ensurePlaceholderResources", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function makeProject(): Promise<string> {
    const projectDir = join(tmpdir(), `monolith-ensure-${Date.now()}-${Math.random()}`)
    tempDirs.push(projectDir)
    await mkdir(join(projectDir, ".monolith", "state"), { recursive: true })
    await writeFile(
      join(projectDir, "wrangler.jsonc"),
      `{
  "name": "demo-worker",
  "main": "src/index.ts",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "demo-db",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "REPLACE_WITH_KV_NAMESPACE_ID"
    }
  ]
}
`
    )
    await writeFile(
      join(projectDir, ".monolith", "state", "dev.json"),
      `${JSON.stringify({
        stackName: "demo-worker",
        stage: "dev",
        resources: [
          { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
          {
            id: "d1:DB",
            kind: "d1",
            binding: "DB",
            name: "demo-db",
            databaseId: "REPLACE_WITH_D1_DATABASE_ID"
          },
          {
            id: "kv:KV",
            kind: "kv",
            binding: "KV",
            namespaceId: "REPLACE_WITH_KV_NAMESPACE_ID"
          }
        ],
        updatedAt: "2026-01-01T00:00:00.000Z",
        wranglerConfigPath: "wrangler.jsonc"
      }, null, 2)}\n`
    )
    return projectDir
  }

  it("creates D1 and KV via wrangler and updates config + state", async () => {
    const projectDir = await makeProject()

    const mockWrangler: RunWranglerCommand = async (args) => {
      if (args[0] === "d1" && args[1] === "create") {
        return {
          exitCode: 0,
          output: 'database_id = "22222222-2222-2222-2222-222222222222"\n'
        }
      }
      if (args[0] === "kv" && args[1] === "namespace" && args[2] === "create") {
        return {
          exitCode: 0,
          output: 'id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"\n'
        }
      }
      return { exitCode: 1, output: "unexpected command" }
    }

    const result = await runCli(
      projectDir,
      ensurePlaceholderResources({
        stage: "dev",
        projectDir,
        configPath: "wrangler.jsonc",
        runWrangler: mockWrangler
      })
    )

    const config = JSON.parse(await readFile(join(projectDir, "wrangler.jsonc"), "utf8"))
    expect(config.d1_databases[0].database_id).toBe("22222222-2222-2222-2222-222222222222")
    expect(config.kv_namespaces[0].id).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")

    const state = JSON.parse(await readFile(join(projectDir, ".monolith", "state", "dev.json"), "utf8"))
    expect(state.resources.find((r: { id: string }) => r.id === "d1:DB").databaseId).toBe(
      "22222222-2222-2222-2222-222222222222"
    )
    expect(state.resources.find((r: { id: string }) => r.id === "kv:KV").namespaceId).toBe(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    )
  })

  it("skips when IDs are real and --ensure-resources is not set", async () => {
    const projectDir = await makeProject()
    const configPath = join(projectDir, "wrangler.jsonc")
    const config = JSON.parse(await readFile(configPath, "utf8"))
    config.d1_databases[0].database_id = "70b33c81-e63d-44c1-a414-b48aa3e032ec"
    config.kv_namespaces[0].id = "58e35e39e0ba4816b1d5d666898b55be"
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

    const mockWrangler: RunWranglerCommand = async () => ({
      exitCode: 1,
      output: "should not run\n"
    })

    const result = await runCli(
      projectDir,
      ensurePlaceholderResources({
        stage: "dev",
        projectDir,
        configPath: "wrangler.jsonc",
        runWrangler: mockWrangler
      })
    )

    expect(result.state).toBeDefined()
  })
})
