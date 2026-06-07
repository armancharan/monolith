import type { MonolithState } from "@monolith/core"
import { describe, expect, it, vi } from "vitest"
import { CloudflareClient } from "./client.js"
import {
  buildCloudDriftHints,
  formatCloudDriftHints,
  readCloudWorker,
  type CloudWorkerReadResult
} from "./read.js"

const baseState = (): MonolithState => ({
  stackName: "demo-worker",
  stage: "dev",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deployedAt: "2026-01-01T00:00:00.000Z",
  resources: [
    { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
    {
      id: "d1:DB",
      kind: "d1",
      binding: "DB",
      name: "demo-db",
      databaseId: "11111111-1111-1111-1111-111111111111"
    },
    {
      id: "kv:KV",
      kind: "kv",
      binding: "KV",
      namespaceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
})

describe("readCloudWorker", () => {
  it("reads worker settings and deployments with mocked fetch and wrangler", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/workers/scripts/demo-worker/settings")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              compatibility_date: "2025-03-01",
              bindings: [
                { name: "DB", type: "d1", id: "11111111-1111-1111-1111-111111111111" },
                { name: "KV", type: "kv_namespace", namespace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
                { name: "EXTRA", type: "r2_bucket", bucket_name: "orphan-bucket" }
              ]
            }
          }),
          { status: 200 }
        )
      }

      if (url.includes("/accounts")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ id: "acct-1", name: "Example" }]
          }),
          { status: 200 }
        )
      }

      return new Response(JSON.stringify({ success: false, errors: [{ message: "not found" }] }), {
        status: 404
      })
    })

    const client = new CloudflareClient({
      token: "test-token",
      fetchImpl: fetchImpl as typeof fetch
    })

    const runWranglerDeployments = vi.fn(async () =>
      ({
        ok: true,
        value: [
          {
            Id: "dep-123",
            Created: "2026-06-07T12:00:00.000Z",
            Source: "wrangler deploy"
          }
        ]
      }) as const
    )

    const result = await readCloudWorker({
      state: baseState(),
      projectDir: "/tmp/project",
      client,
      accountId: "acct-1",
      runWranglerDeployments
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.workerName).toBe("demo-worker")
      expect(result.value.completeness).toBe("full")
      expect(result.value.bindings).toHaveLength(3)
      expect(result.value.latestDeployment?.id).toBe("dep-123")
    }
    expect(runWranglerDeployments).toHaveBeenCalledWith("/tmp/project", "demo-worker", undefined)
  })

  it("returns partial result when settings API fails but deployments succeed", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/settings")) {
        return new Response(
          JSON.stringify({ success: false, errors: [{ message: "Unauthorized" }] }),
          { status: 401 }
        )
      }
      return new Response(JSON.stringify({ success: true, result: [{ id: "acct-1", name: "Example" }] }), {
        status: 200
      })
    })

    const client = new CloudflareClient({
      token: "test-token",
      fetchImpl: fetchImpl as typeof fetch
    })

    const result = await readCloudWorker({
      state: baseState(),
      projectDir: "/tmp/project",
      client,
      accountId: "acct-1",
      runWranglerDeployments: async () =>
        ({
          ok: true,
          value: [{ id: "dep-only", created_on: "2026-06-07T12:00:00.000Z" }]
        }) as const
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.completeness).toBe("partial")
      expect(result.value.latestDeployment?.id).toBe("dep-only")
      expect(result.value.bindings).toBeUndefined()
    }
  })
})

describe("buildCloudDriftHints", () => {
  it("flags cloud-only and local-only bindings", () => {
    const read: CloudWorkerReadResult = {
      workerName: "demo-worker",
      accountId: "acct-1",
      completeness: "full",
      bindings: [
        { name: "DB", type: "d1", resourceId: "11111111-1111-1111-1111-111111111111" },
        { name: "EXTRA", type: "r2", resourceId: "orphan-bucket" }
      ],
      latestDeployment: {
        id: "dep-new",
        createdAt: "2026-06-08T00:00:00.000Z"
      },
      limitations: []
    }

    const hints = buildCloudDriftHints(baseState(), read)
    expect(hints.hints.some((hint) => hint.includes("Cloud binding not in local state"))).toBe(true)
    expect(hints.hints.some((hint) => hint.includes("Local binding not seen in cloud settings"))).toBe(true)
    expect(hints.hints.some((hint) => hint.includes("newer than state.deployedAt"))).toBe(true)
  })

  it("formats cloud drift section for plan output", () => {
    const output = formatCloudDriftHints({
      read: {
        workerName: "demo-worker",
        accountId: "acct-1",
        completeness: "partial",
        bindings: [{ name: "DB", type: "d1" }],
        limitations: ["Example limitation"]
      },
      hints: ["Cloud deployment: dep-1"]
    })

    expect(output).toContain("Cloud drift (partial)")
    expect(output).toContain("demo-worker")
    expect(output).toContain("Cloud deployment: dep-1")
    expect(output).toContain("Example limitation")
  })

  it("formats skipped cloud drift output", () => {
    const output = formatCloudDriftHints({
      hints: [],
      skippedReason: "No Cloudflare credentials found"
    })

    expect(output).toContain("Cloud drift (skipped)")
    expect(output).toContain("No Cloudflare credentials found")
  })
})
