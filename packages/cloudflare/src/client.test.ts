import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import { makeCloudflareClient } from "./services/CloudflareClient.js"

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

    const client = makeCloudflareClient({
      token: "test-token",
      auth: { token: "test-token", source: "env:api_token" },
      fetchImpl: fetchImpl as typeof fetch
    })

    const result = await Effect.runPromise(client.whoami())
    expect(result.user.email).toBe("dev@example.com")
    expect(result.accounts).toEqual([{ id: "acct-1", name: "Example Account" }])
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

    const client = makeCloudflareClient({
      token: "test-token",
      fetchImpl: fetchImpl as typeof fetch
    })

    const result = await Effect.runPromise(client.getAccountId())
    expect(result).toBe("acct-default")
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

    const client = makeCloudflareClient({
      token: "bad-token",
      fetchImpl: fetchImpl as typeof fetch
    })

    await expect(Effect.runPromise(client.request("/user"))).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("Unauthorized")
    })
  })
})
