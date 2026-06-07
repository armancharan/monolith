import { StateStore } from "@monolith/core"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeMonolithLive, MonolithLive } from "./index.js"

describe("MonolithLive", () => {
  it("exposes StateStore when provided", async () => {
    const program = Effect.gen(function* () {
      const store = yield* StateStore
      return typeof store.loadState
    })

    const hasStore = await Effect.runPromise(
      Effect.provide(program, makeMonolithLive("/tmp/monolith-effect-test"))
    )
    expect(hasStore).toBe("function")
  })

  it("default MonolithLive uses cwd", () => {
    expect(MonolithLive).toBeDefined()
  })
})
