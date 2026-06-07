import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import { makeCloudflareClient } from "./services/CloudflareClient.js"
import { bindingsToStateResources, readActualWorker } from "./read.js"

describe("bindingsToStateResources", () => {
  it("maps CF settings API bindings to Monolith StateResource IDs", () => {
    const resources = bindingsToStateResources("demo-worker", [
      { name: "DB", type: "d1", id: "11111111-1111-1111-1111-111111111111" },
      { name: "KV", type: "kv_namespace", namespace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { name: "ASSETS", type: "r2_bucket", bucket_name: "my-bucket" },
      { name: "JOBS", type: "queue", queue_name: "jobs-queue" },
      {
        name: "ROOMS",
        type: "durable_object_namespace",
        class_name: "ChatRoom",
        script_name: "chat-do"
      }
    ])

    expect(resources).toEqual([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
      {
        id: "d1:DB",
        kind: "d1",
        binding: "DB",
        name: "DB",
        databaseId: "11111111-1111-1111-1111-111111111111"
      },
      {
        id: "kv:KV",
        kind: "kv",
        binding: "KV",
        namespaceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      {
        id: "r2:ASSETS",
        kind: "r2",
        binding: "ASSETS",
        bucketName: "my-bucket"
      },
      {
        id: "queue:JOBS",
        kind: "queue",
        binding: "JOBS",
        name: "jobs-queue"
      },
      {
        id: "durable_object:ROOMS",
        kind: "durable_object",
        binding: "ROOMS",
        name: "ChatRoom",
        className: "ChatRoom",
        scriptName: "chat-do"
      }
    ])
  })
})

describe("readActualWorker", () => {
  it("reads worker settings and returns StateResource[]", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes("/workers/scripts/demo-worker/settings")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              compatibility_date: "2025-03-01",
              bindings: [
                { name: "DB", type: "d1", id: "11111111-1111-1111-1111-111111111111" },
                { name: "KV", type: "kv_namespace", namespace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
              ]
            }
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ success: false, errors: [{ message: "not found" }] }), {
        status: 404
      })
    })

    const client = makeCloudflareClient({
      token: "test-token",
      fetchImpl: fetchImpl as typeof fetch
    })

    const result = await Effect.runPromise(readActualWorker(client, "acct-1", "demo-worker"))
    expect(result).toHaveLength(3)
    expect(result[0]?.id).toBe("worker:demo-worker")
    expect(result.find((resource) => resource.id === "d1:DB")?.databaseId).toBe(
      "11111111-1111-1111-1111-111111111111"
    )
  })

  it("returns API error when worker settings are unavailable", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, errors: [{ message: "Unauthorized" }] }), {
        status: 401
      })
    )

    const client = makeCloudflareClient({
      token: "test-token",
      fetchImpl: fetchImpl as typeof fetch
    })

    await expect(
      Effect.runPromise(readActualWorker(client, "acct-1", "missing-worker"))
    ).rejects.toBeDefined()
  })
})
