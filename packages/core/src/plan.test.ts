import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { formatCloudPlan, formatPlan, planState } from "./plan.js"
import { PlanEngine, PlanEngineLive } from "./services/PlanEngine.js"
import type { MonolithState } from "./state.js"

const runPlan = (current: MonolithState, desired: MonolithState) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* PlanEngine
      return yield* engine.plan(current, desired)
    }).pipe(Effect.provide(PlanEngineLive))
  )

const baseState = (resources: MonolithState["resources"]): MonolithState => ({
  stackName: "demo-worker",
  stage: "dev",
  resources,
  updatedAt: "2026-01-01T00:00:00.000Z"
})

describe("planState", () => {
  it("reports no changes when current matches desired", () => {
    const state = baseState([
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
    ])

    const result = planState(state, state)
    expect(result.hasChanges).toBe(false)
    expect(result.changes).toHaveLength(0)
  })

  it("detects creates for new resources", () => {
    const current = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" }
    ])
    const desired = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
      {
        id: "kv:KV",
        kind: "kv",
        binding: "KV",
        namespaceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ])

    const result = planState(current, desired)
    expect(result.hasChanges).toBe(true)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]?.type).toBe("create")
    expect(result.changes[0]?.resource.id).toBe("kv:KV")
    expect(result.changes[0]?.bindingChange).toBe(true)
  })

  it("detects deletes for removed resources", () => {
    const current = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
      {
        id: "d1:DB",
        kind: "d1",
        binding: "DB",
        name: "demo-db",
        databaseId: "11111111-1111-1111-1111-111111111111"
      }
    ])
    const desired = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" }
    ])

    const result = planState(current, desired)
    expect(result.hasChanges).toBe(true)
    expect(result.changes[0]?.type).toBe("delete")
    expect(result.changes[0]?.bindingChange).toBe(true)
  })

  it("detects updates and highlights binding field changes", () => {
    const current = baseState([
      {
        id: "d1:DB",
        kind: "d1",
        binding: "DB",
        name: "demo-db",
        databaseId: "11111111-1111-1111-1111-111111111111"
      }
    ])
    const desired = baseState([
      {
        id: "d1:DB",
        kind: "d1",
        binding: "DB",
        name: "demo-db",
        databaseId: "22222222-2222-2222-2222-222222222222"
      }
    ])

    const result = planState(current, desired)
    expect(result.changes[0]?.type).toBe("update")
    expect(result.changes[0]?.bindingChange).toBe(false)
    expect(result.changes[0]?.fieldChanges).toEqual([
      {
        field: "databaseId",
        from: "11111111-1111-1111-1111-111111111111",
        to: "22222222-2222-2222-2222-222222222222"
      }
    ])
  })

  it("formats human-readable plan output", () => {
    const current = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" }
    ])
    const desired = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
      {
        id: "kv:KV",
        kind: "kv",
        binding: "KV",
        namespaceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ])

    const result = planState(current, desired)
    const output = formatPlan("dev", current, { ...result, desiredSource: "import" })

    expect(output).toContain('Plan for stage "dev"')
    expect(output).toContain("+ create kv kv:KV")
    expect(output).toContain("[binding change]")
  })

  it("detects queue and durable object binding changes", () => {
    const current = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" }
    ])
    const desired = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
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
        className: "ChatRoom"
      }
    ])

    const result = planState(current, desired)
    expect(result.hasChanges).toBe(true)
    expect(result.changes.map((change) => change.resource.id)).toEqual([
      "durable_object:ROOMS",
      "queue:JOBS"
    ])
  })

  it("formats no-op plan output", () => {
    const state = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" }
    ])
    const result = planState(state, state)
    const output = formatPlan("dev", state, result)

    expect(output).toContain("No changes. Infrastructure matches desired state.")
  })

  it("PlanEngine matches pure planState", async () => {
    const current = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" }
    ])
    const desired = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
      {
        id: "kv:KV",
        kind: "kv",
        binding: "KV",
        namespaceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ])

    const pure = planState(current, desired)
    const viaEngine = await runPlan(current, desired)
    expect(viaEngine.hasChanges).toBe(pure.hasChanges)
    expect(viaEngine.changes).toEqual(pure.changes)
  })

  it("formats cloud plan with drift and pending sections", () => {
    const actual = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
      {
        id: "kv:KV",
        kind: "kv",
        binding: "KV",
        namespaceId: "cloud-id"
      }
    ])
    const desired = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" },
      {
        id: "kv:KV",
        kind: "kv",
        binding: "KV",
        namespaceId: "desired-id"
      }
    ])
    const persisted = baseState([
      { id: "worker:demo-worker", kind: "worker", name: "demo-worker" }
    ])

    const drift = planState(actual, desired)
    const pending = planState(persisted, desired)

    const output = formatCloudPlan("dev", "demo-worker", {
      desiredSource: "wrangler",
      drift,
      pending
    })

    expect(output).toContain("Changes vs cloud (drift)")
    expect(output).toContain("Changes vs last state")
    expect(output).toContain("namespaceId: cloud-id → desired-id")
    expect(output).toContain("+ create kv kv:KV")
  })
})
