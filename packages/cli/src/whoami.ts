import { CloudflareClient } from "@monolith/cloudflare"

export async function runWhoami(args: string[]): Promise<number> {
  const projectDir = process.cwd()
  const clientResult = await CloudflareClient.create({ projectDir })
  if (!clientResult.ok) {
    console.error(clientResult.error.message)
    return 1
  }

  const whoamiResult = await clientResult.value.whoami()
  if (!whoamiResult.ok) {
    console.error(whoamiResult.error.message)
    return 1
  }

  const { auth, user, accounts } = whoamiResult.value
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
    const accountIdResult = await clientResult.value.getAccountId()
    if (accountIdResult.ok) {
      console.log("")
      console.log(`Default account ID: ${accountIdResult.value}`)
    }
  }

  return 0
}
