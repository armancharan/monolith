import { describe, expect, it, vi } from "vitest"
import { deployWithDoMigration, detectDoMigrations } from "./do-migration.js"
import { parseWranglerConfigText } from "./wrangler-import.js"

describe("detectDoMigrations", () => {
  it("detects new_classes migrations with DO bindings", () => {
    const jsonc = `
{
  "name": "do-worker",
  "main": "src/index.ts",
  "durable_objects": {
    "bindings": [{ "name": "ROOMS", "class_name": "ChatRoom" }],
    "migrations": [{ "tag": "v1", "new_classes": ["ChatRoom"] }]
  }
}
`
    const config = parseWranglerConfigText(jsonc, "/tmp/wrangler.jsonc")
    const info = detectDoMigrations(config)

    expect(info.requiresTwoStepDeploy).toBe(true)
    expect(info.migrationTags).toEqual(["v1"])
    expect(info.newClasses).toEqual(["ChatRoom"])
  })

  it("does not require two-step deploy without new classes", () => {
    const jsonc = `
{
  "name": "do-worker",
  "main": "src/index.ts",
  "durable_objects": {
    "bindings": [{ "name": "ROOMS", "class_name": "ChatRoom" }],
    "migrations": [{ "tag": "v1", "renamed_classes": [{ "from": "OldRoom", "to": "ChatRoom" }] }]
  }
}
`
    const config = parseWranglerConfigText(jsonc, "/tmp/wrangler.jsonc")
    const info = detectDoMigrations(config)

    expect(info.requiresTwoStepDeploy).toBe(false)
  })

  it("does not require two-step deploy when migrations exist but no DO bindings", () => {
    const jsonc = `
{
  "name": "do-worker",
  "main": "src/index.ts",
  "durable_objects": {
    "migrations": [{ "tag": "v1", "new_classes": ["ChatRoom"] }]
  }
}
`
    const config = parseWranglerConfigText(jsonc, "/tmp/wrangler.jsonc")
    expect(detectDoMigrations(config).requiresTwoStepDeploy).toBe(false)
  })
})

describe("deployWithDoMigration", () => {
  it("runs wrangler deploy twice when new DO migration is present", async () => {
    const jsonc = `
{
  "name": "do-worker",
  "main": "src/index.ts",
  "durable_objects": {
    "bindings": [{ "name": "ROOMS", "class_name": "ChatRoom" }],
    "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatRoom"] }]
  }
}
`
    const config = parseWranglerConfigText(jsonc, "/tmp/wrangler.jsonc")
    const deploy = vi.fn(async () => ({ exitCode: 0, output: "deployed\n" }))

    const result = await deployWithDoMigration("/tmp/project", "wrangler.jsonc", deploy, config)

    expect(deploy).toHaveBeenCalledTimes(2)
    expect(deploy).toHaveBeenNthCalledWith(1, "/tmp/project", "wrangler.jsonc")
    expect(deploy).toHaveBeenNthCalledWith(2, "/tmp/project", "wrangler.jsonc")
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("DO migration second deploy")
  })

  it("runs deploy once when no migration requires two-step pattern", async () => {
    const jsonc = `{ "name": "plain-worker", "main": "src/index.ts" }`
    const config = parseWranglerConfigText(jsonc, "/tmp/wrangler.jsonc")
    const deploy = vi.fn(async () => ({ exitCode: 0, output: "deployed\n" }))

    await deployWithDoMigration("/tmp/project", undefined, deploy, config)

    expect(deploy).toHaveBeenCalledTimes(1)
  })

  it("stops after first deploy failure", async () => {
    const jsonc = `
{
  "name": "do-worker",
  "main": "src/index.ts",
  "durable_objects": {
    "bindings": [{ "name": "ROOMS", "class_name": "ChatRoom" }],
    "migrations": [{ "tag": "v1", "new_classes": ["ChatRoom"] }]
  }
}
`
    const config = parseWranglerConfigText(jsonc, "/tmp/wrangler.jsonc")
    const deploy = vi.fn(async () => ({ exitCode: 1, output: "failed\n" }))

    const result = await deployWithDoMigration("/tmp/project", "wrangler.jsonc", deploy, config)

    expect(deploy).toHaveBeenCalledTimes(1)
    expect(result.exitCode).toBe(1)
  })
})
