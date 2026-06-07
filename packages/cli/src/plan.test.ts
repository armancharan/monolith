import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MonolithState } from "@monolith/core"
import * as cloudflare from "@monolith/cloudflare"
import { CloudflareAuthError } from "@monolith/cloudflare"
import { Effect } from "effect"
import { resolveCloudActual, resolveCloudDrift } from "./plan.js"
import { runCli } from "./runtime.js"

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
  const originalToken = process.env.CLOUDFLARE_API_TOKEN

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.CLOUDFLARE_API_TOKEN
    } else {
      process.env.CLOUDFLARE_API_TOKEN = originalToken
    }
    vi.unstubAllGlobals()
  })

  it("returns undefined in auto mode when auth is unavailable", async () => {
    const { projectDir, state } = await createPlanProject()
    delete process.env.CLOUDFLARE_API_TOKEN

    const readSpy = vi
      .spyOn(cloudflare, "readCloudWorker")
      .mockReturnValue(
        Effect.fail(
          new CloudflareAuthError({ message: "No Cloudflare credentials found" })
        )
      )

    try {
      const drift = await runCli(projectDir, resolveCloudDrift(state, projectDir, "auto"))
      expect(drift).toBeUndefined()
    } finally {
      readSpy.mockRestore()
    }
  })

  it("returns skipped reason when --cloud is forced without auth", async () => {
    const { projectDir, state } = await createPlanProject()
    delete process.env.CLOUDFLARE_API_TOKEN

    const readSpy = vi
      .spyOn(cloudflare, "readCloudWorker")
      .mockReturnValue(
        Effect.fail(
          new CloudflareAuthError({ message: "No Cloudflare credentials found" })
        )
      )

    try {
      const drift = await runCli(projectDir, resolveCloudDrift(state, projectDir, "on"))
      expect(drift?.skippedReason).toContain("No Cloudflare credentials found")
    } finally {
      readSpy.mockRestore()
    }
  })
})

describe("resolveCloudActual", () => {
  const originalToken = process.env.CLOUDFLARE_API_TOKEN

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.CLOUDFLARE_API_TOKEN
    } else {
      process.env.CLOUDFLARE_API_TOKEN = originalToken
    }
    vi.unstubAllGlobals()
  })

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

    process.env.CLOUDFLARE_API_TOKEN = "test-token"
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
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
    )

    const result = await runCli(
      projectDir,
      resolveCloudActual(state, desired, projectDir, "on")
    )
    expect(result?.drift?.hasChanges).toBe(true)
    expect(
      result?.drift?.changes.some(
        (change) => change.resource.id === "d1:DB" && change.fieldChanges?.some((f) => f.field === "databaseId")
      )
    ).toBe(true)
  })
})
