import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it, vi } from "vitest"
import { CloudflareAuthError, CloudflareClient } from "@monolith/cloudflare"
import type { MonolithState } from "@monolith/core"
import { resolveCloudActual, resolveCloudDrift } from "./plan.js"

async function createPlanProject(): Promise<{ projectDir: string; state: MonolithState }> {
  const projectDir = join(tmpdir(), `monolith-plan-cloud-${Date.now()}-${Math.random()}`)
  await mkdir(join(projectDir, ".monolith", "state"), { recursive: true })
  const state: MonolithState = {
    stackName: "demo-worker",
    stage: "dev",
    deployedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    resources: [
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
      {
        id: "kv:KV",
        kind: "kv",
        binding: "KV",
        namespaceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ]
  }
  await writeFile(
    join(projectDir, ".monolith", "state", "dev.json"),
    `${JSON.stringify(state, null, 2)}\n`
  )
  return { projectDir, state }
}

describe("resolveCloudDrift", () => {
  it("returns undefined in auto mode when auth is unavailable", async () => {
    const { projectDir, state } = await createPlanProject()
    const createSpy = vi.spyOn(CloudflareClient, "create").mockResolvedValue({
      ok: false,
      error: new CloudflareAuthError("missing token")
    })

    const drift = await resolveCloudDrift(state, projectDir, "auto")
    expect(drift).toBeUndefined()
    createSpy.mockRestore()
  })

  it("returns skipped reason when --cloud is forced without auth", async () => {
    const { projectDir, state } = await createPlanProject()
    const createSpy = vi.spyOn(CloudflareClient, "create").mockResolvedValue({
      ok: false,
      error: new CloudflareAuthError("missing token")
    })

    const drift = await resolveCloudDrift(state, projectDir, "on")
    expect(drift?.skippedReason).toContain("missing token")
    createSpy.mockRestore()
  })
})

describe("resolveCloudActual", () => {
  it("computes drift from cloud actual vs desired when authed", async () => {
    const { projectDir, state } = await createPlanProject()
    const desired: MonolithState = {
      ...state,
      resources: [
        ...state.resources,
        {
          id: "d1:DB",
          kind: "d1",
          binding: "DB",
          name: "demo-db",
          databaseId: "11111111-1111-1111-1111-111111111111"
        }
      ]
    }

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes("/workers/scripts/demo-worker/settings")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              bindings: [
                { name: "KV", type: "kv_namespace", namespace_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
                { name: "DB", type: "d1", id: "22222222-2222-2222-2222-222222222222" }
              ]
            }
          }),
          { status: 200 }
        )
      }
      if (url.includes("/accounts")) {
        return new Response(
          JSON.stringify({ success: true, result: [{ id: "acct-1", name: "Example" }] }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ success: false, errors: [{ message: "not found" }] }), {
        status: 404
      })
    })

    const createSpy = vi.spyOn(CloudflareClient, "create").mockResolvedValue({
      ok: true,
      value: new CloudflareClient({
        token: "test-token",
        fetchImpl: fetchImpl as typeof fetch
      })
    })

    const result = await resolveCloudActual(state, desired, projectDir, "on")
    expect(result?.drift?.hasChanges).toBe(true)
    expect(
      result?.drift?.changes.some(
        (change) => change.resource.id === "d1:DB" && change.fieldChanges?.some((f) => f.field === "databaseId")
      )
    ).toBe(true)

    createSpy.mockRestore()
  })
})
