import type { Env, Hono } from "hono"

export type { Hono } from "hono"

/**
 * Wrap a Hono app as a Cloudflare Worker default export.
 * Equivalent to `export default app` but explicit for Monolith stacks.
 */
export function createHonoWorker<E extends Env>(
  app: Hono<E>
): { fetch: typeof app.fetch } {
  return { fetch: app.fetch.bind(app) }
}
