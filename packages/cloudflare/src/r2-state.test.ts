import { describe, expect, it, vi } from "vitest"
import { R2StateBackend } from "./r2-state.js"

describe("R2StateBackend", () => {
  it("pull returns parsed state on 200", async () => {
    const state = {
      stackName: "demo",
      stage: "dev",
      resources: [],
      updatedAt: "2026-01-01T00:00:00.000Z"
    }

    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(state), { status: 200 })
    )

    const backend = new R2StateBackend({
      bucket: "monolith-state",
      accountId: "acct123",
      accessKeyId: "key",
      secretAccessKey: "secret",
      fetchImpl
    })

    const result = await backend.pull("dev")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stackName).toBe("demo")
    }
    expect(fetchImpl).toHaveBeenCalled()
  })

  it("push sends PUT with state body", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }))
    const backend = new R2StateBackend({
      bucket: "monolith-state",
      accountId: "acct123",
      accessKeyId: "key",
      secretAccessKey: "secret",
      fetchImpl
    })

    const result = await backend.push("dev", {
      stackName: "demo",
      stage: "dev",
      resources: [],
      updatedAt: "2026-01-01T00:00:00.000Z"
    })

    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/monolith-state/monolith/state/dev.json"),
      expect.objectContaining({ method: "PUT" })
    )
  })

  it("fromEnv fails without bucket", () => {
    const result = R2StateBackend.fromEnv({ MONOLITH_STATE_BACKEND: "r2" })
    expect(result.ok).toBe(false)
  })
})
