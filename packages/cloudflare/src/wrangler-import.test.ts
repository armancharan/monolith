import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  formatImportSummary,
  generateMonolithRunTs,
  parseWranglerConfigText,
  toStackResources
} from "./wrangler-import.js"

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures")
const dogfoodFixture = readFileSync(
  join(fixtureDir, "dogfood-wrangler.jsonc"),
  "utf8"
)

describe("parseWranglerConfigText", () => {
  it("parses dogfood jsonc fixture with comments stripped", () => {
    const result = parseWranglerConfigText(
      dogfoodFixture,
      "/tmp/dogfood/wrangler.jsonc"
    )

    expect(result.workerName).toBe("monolith-m1-dogfood")
    expect(result.main).toBe("src/index.ts")
    expect(result.compatibilityDate).toBe("2025-03-01")
    expect(result.d1Databases).toEqual([
      {
        binding: "DB",
        databaseName: "dogfood-db",
        databaseId: "70b33c81-e63d-44c1-a414-b48aa3e032ec"
      }
    ])
    expect(result.kvNamespaces).toEqual([
      {
        binding: "KV",
        id: "58e35e39e0ba4816b1d5d666898b55be"
      }
    ])
  })

  it("maps wrangler bindings to stack resources", () => {
    const result = parseWranglerConfigText(
      dogfoodFixture,
      "/tmp/dogfood/wrangler.jsonc"
    )
    const resources = toStackResources(result)

    expect(resources.worker).toEqual({
      type: "worker",
      name: "monolith-m1-dogfood"
    })
    expect(resources.d1).toEqual([
      {
        type: "d1",
        name: "DB",
        databaseId: "70b33c81-e63d-44c1-a414-b48aa3e032ec"
      }
    ])
    expect(resources.kv).toEqual([
      {
        type: "kv",
        name: "KV",
        namespaceId: "58e35e39e0ba4816b1d5d666898b55be"
      }
    ])
  })

  it("generates monolith.run.ts from import result", () => {
    const result = parseWranglerConfigText(
      dogfoodFixture,
      "/tmp/dogfood/wrangler.jsonc"
    )
    const generated = generateMonolithRunTs(result)

    expect(generated).toContain('stack("monolith-m1-dogfood"')
    expect(generated).toContain('ctx.d1("DB"')
    expect(generated).toContain('ctx.kv("KV"')
  })

  it("formats a human-readable import summary", () => {
    const result = parseWranglerConfigText(
      dogfoodFixture,
      "/tmp/dogfood/wrangler.jsonc"
    )
    const summary = formatImportSummary(result)

    expect(summary).toContain("monolith-m1-dogfood")
    expect(summary).toContain("D1: DB")
    expect(summary).toContain("KV: KV")
  })

  it("parses wrangler.toml queue and r2 bindings", () => {
    const toml = `
name = "queue-worker"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[d1_databases]]
binding = "DB"
database_name = "app-db"
database_id = "11111111-1111-1111-1111-111111111111"

[[kv_namespaces]]
binding = "CACHE"
id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "my-bucket"

[[queues.producers]]
binding = "JOBS"
queue = "jobs-queue"
`
    const result = parseWranglerConfigText(toml, "/tmp/wrangler.toml")

    expect(result.workerName).toBe("queue-worker")
    expect(result.r2Buckets).toEqual([
      { binding: "ASSETS", bucketName: "my-bucket" }
    ])
    expect(result.queues).toEqual([
      { binding: "JOBS", queueName: "jobs-queue" }
    ])
  })
})
