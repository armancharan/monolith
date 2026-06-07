import { describe, expect, it } from "vitest"
import {
  evaluateRouteAssertions,
  joinWorkerUrl,
  normalizeAssertionRoutes
} from "./assertions.js"
import type { HttpFetch } from "./test.js"

describe("normalizeAssertionRoutes", () => {
  it("reads routes array", () => {
    const routes = normalizeAssertionRoutes({
      routes: [{ path: "/health", expectStatus: 200, expectBodyContains: "ok" }]
    })
    expect(routes).toHaveLength(1)
    expect(routes[0]?.path).toBe("/health")
  })

  it("normalizes legacy assertions shape", () => {
    const routes = normalizeAssertionRoutes({
      assertions: [{ type: "http", path: "/health", expectStatus: 200 }]
    })
    expect(routes[0]?.path).toBe("/health")
  })
})

describe("joinWorkerUrl", () => {
  it("joins base worker url with route path", () => {
    expect(joinWorkerUrl("https://demo.workers.dev", "/health")).toBe(
      "https://demo.workers.dev/health"
    )
  })
})

describe("evaluateRouteAssertions", () => {
  it("passes when status and body match", async () => {
    const fetchImpl: HttpFetch = async () => ({ status: 200, body: "ok" })
    const result = await evaluateRouteAssertions(
      "https://demo.workers.dev",
      [{ path: "/health", expectStatus: 200, expectBodyContains: "ok" }],
      fetchImpl
    )
    expect(result.ok).toBe(true)
  })

  it("fails on status mismatch", async () => {
    const fetchImpl: HttpFetch = async () => ({ status: 500, body: "error" })
    const result = await evaluateRouteAssertions(
      "https://demo.workers.dev",
      [{ path: "/health", expectStatus: 200 }],
      fetchImpl
    )
    expect(result.ok).toBe(false)
  })
})
