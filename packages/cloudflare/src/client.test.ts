import { describe, expect, it, vi } from "vitest"
import { CloudflareClient } from "./client.js"

describe("CloudflareClient", () => {
  it("whoami returns user and accounts from mocked API", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith("/user")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: { id: "user-1", email: "dev@example.com" }
          }),
          { status: 200 }
        )
      }

      if (url.includes("/accounts")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ id: "acct-1", name: "Example Account" }]
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
      auth: { token: "test-token", source: "env:api_token" },
      fetchImpl: fetchImpl as typeof fetch
    })

    const result = await client.whoami()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.user.email).toBe("dev@example.com")
      expect(result.value.accounts).toEqual([{ id: "acct-1", name: "Example Account" }])
    }
  })

  it("getAccountId returns first account id", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [{ id: "acct-default", name: "Default" }]
        }),
        { status: 200 }
      )
    )

    const client = new CloudflareClient({
      token: "test-token",
      fetchImpl: fetchImpl as typeof fetch
    })

    const result = await client.getAccountId()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe("acct-default")
    }
  })

  it("returns API error on non-success response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ message: "Unauthorized" }]
        }),
        { status: 401 }
      )
    )

    const client = new CloudflareClient({
      token: "bad-token",
      fetchImpl: fetchImpl as typeof fetch
    })

    const result = await client.request("/user")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(401)
      expect(result.error.message).toContain("Unauthorized")
    }
  })
})
