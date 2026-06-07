import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it, vi } from "vitest"
import { CloudflareAuthError, CloudflareClient } from "@monolith/cloudflare"
import type { MonolithState } from "@monolith/core"
import { resolveCloudDrift } from "./plan.js"

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
