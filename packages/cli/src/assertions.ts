import type { HttpFetch } from "./test.js"

export interface RouteAssertion {
  path: string
  expectStatus?: number
  expectBodyContains?: string
  expectBody?: string
}

export interface TestAssertionFile {
  version?: number
  routes?: RouteAssertion[]
  /** Legacy shape — normalized to routes when present. */
  assertions?: Array<{
    type?: string
    path?: string
    url?: string
    expectStatus?: number
    expectBody?: string
    expectBodyContains?: string
  }>
}

export function normalizeAssertionRoutes(file: TestAssertionFile): RouteAssertion[] {
  if (file.routes?.length) {
    return file.routes
  }

  const legacy = file.assertions ?? []
  return legacy
    .filter((entry) => entry.type === "http" || entry.path || entry.url)
    .map((entry) => ({
      path: entry.path ?? entry.url ?? "/",
      expectStatus: entry.expectStatus,
      expectBody: entry.expectBody,
      expectBodyContains: entry.expectBodyContains
    }))
}

export function joinWorkerUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return new URL(normalizedPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString()
}

export async function evaluateRouteAssertions(
  baseUrl: string,
  routes: RouteAssertion[],
  fetchImpl: HttpFetch
): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const route of routes) {
    const url = joinWorkerUrl(baseUrl, route.path)
    const expectedStatus = route.expectStatus ?? 200

    let result: { status: number; body?: string }
    try {
      result = await fetchImpl(url)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return { ok: false, message: `Assertion failed for ${route.path}: ${message}` }
    }

    if (result.status !== expectedStatus) {
      return {
        ok: false,
        message: `Assertion failed for ${route.path}: expected status ${expectedStatus}, got ${result.status}`
      }
    }

    if (route.expectBody !== undefined && result.body !== route.expectBody) {
      return {
        ok: false,
        message: `Assertion failed for ${route.path}: body mismatch (expected exact match)`
      }
    }

    if (route.expectBodyContains && !result.body?.includes(route.expectBodyContains)) {
      return {
        ok: false,
        message: `Assertion failed for ${route.path}: body does not contain "${route.expectBodyContains}"`
      }
    }

    console.log(`  ✓ ${route.path} → ${result.status}`)
  }

  return { ok: true }
}
