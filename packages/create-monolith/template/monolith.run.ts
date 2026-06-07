import { Effect } from "effect"
import { stack } from "@monolith/cloudflare"

export default stack("my-worker", (ctx) =>
  Effect.gen(function* () {
    yield* ctx.worker("my-worker")
    yield* ctx.d1("DB")
    yield* ctx.kv("KV")
  })
)
