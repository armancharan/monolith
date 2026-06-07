import { CloudflareClient } from "@monolith/cloudflare"
import { Effect } from "effect"

export const runWhoami = (
  args: string[]
): Effect.Effect<number, never, CloudflareClient> =>
  Effect.gen(function* () {
    const client = yield* CloudflareClient

    const whoamiResult = yield* client.whoami().pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return 1
        })
      )
    )

    if (typeof whoamiResult === "number") {
      return whoamiResult
    }

    const { auth, user, accounts } = whoamiResult
    const authLabel =
      auth.source === "env:api_token"
        ? "CLOUDFLARE_API_TOKEN"
        : auth.configPath ?? auth.source

    console.log(`Authenticated via ${authLabel}`)
    console.log(`User: ${user.email} (${user.id})`)
    console.log("")
    console.log("Accounts:")
    for (const account of accounts) {
      console.log(`  ${account.name} (${account.id})`)
    }

    if (args.includes("--account-id")) {
      const accountId = yield* client.getAccountId().pipe(Effect.result)
      if (accountId._tag === "Success") {
        console.log("")
        console.log(`Default account ID: ${accountId.success}`)
      }
    }

    return 0
  })
