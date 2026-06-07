import { describe, expect, it } from "vitest"
import { snapshotToWranglerConfigObject } from "./wrangler-config.js"

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
