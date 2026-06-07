import { describe, expect, it } from "vitest"
import { stack } from "./stack.js"

describe("cloudflare stack helpers", () => {
  it("exposes queue and durableObject bindings on stack context", async () => {
    const bindings: unknown[] = []

    const mod = stack("test-stack", async (ctx) => {
      ctx.worker("api")
      bindings.push(ctx.queue("JOBS", { queueName: "jobs-queue" }))
      bindings.push(
        ctx.durableObject("ROOMS", { className: "ChatRoom", scriptName: "chat-do" })
      )
    })

    await mod.configure({} as never)

    expect(bindings).toEqual([
      { type: "queue", name: "JOBS", queueName: "jobs-queue", id: undefined },
      {
        type: "durable_object",
        name: "ROOMS",
        className: "ChatRoom",
        scriptName: "chat-do"
      }
    ])
  })
})
