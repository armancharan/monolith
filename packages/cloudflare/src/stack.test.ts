import { createStackContext } from "@monolith/core"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { stack } from "./stack.js"

describe("cloudflare stack helpers", () => {
  it("exposes queue and durableObject bindings on stack context", async () => {
    const bindings: unknown[] = []

    const mod = stack("test-stack", (ctx) =>
      Effect.gen(function* () {
        yield* ctx.worker("api")
        bindings.push(yield* ctx.queue("JOBS", { queueName: "jobs-queue" }))
        bindings.push(
          yield* ctx.durableObject("ROOMS", { className: "ChatRoom", scriptName: "chat-do" })
        )
      })
    )

    await Effect.runPromise(mod.configure(createStackContext("dev")))

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
