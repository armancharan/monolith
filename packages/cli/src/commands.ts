/**
 * M1 CLI commands — C1 import, C2 whoami, C5 state wired.
 */
import { runImport } from "./import.js"
import { runStateInit } from "./state.js"
import { runWhoami } from "./whoami.js"

export type CommandName =
  | "init"
  | "import"
  | "plan"
  | "deploy"
  | "help"
  | "whoami"
  | "state"

export async function runCommand(name: CommandName, args: string[]): Promise<number> {
  switch (name) {
    case "init":
      console.log("monolith init — not implemented (C0 scaffold)")
      return 0
    case "import":
      return runImport(args)
    case "plan":
      console.log("monolith plan — not implemented (C6 plan engine next)")
      return 0
    case "deploy":
      console.log("monolith deploy — not implemented (C7 deploy next)")
      return 0
    case "whoami":
      return runWhoami(args)
    case "state":
      if (args[0] === "init") {
        return runStateInit(args.slice(1))
      }
      console.error("Usage: monolith state init --stage <name> [--from <import.json>]")
      return 1
    case "help":
      printHelp()
      return 0
  }
}

export function printHelp(): void {
  console.log(`monolith — TypeScript IaC for Cloudflare Workers (M1)

Usage:
  monolith init
  monolith import <wrangler.toml|wrangler.json|wrangler.jsonc> [--stage <name>]
  monolith state init --stage <name> [--from .monolith/import/<hash>.json]
  monolith whoami [--account-id]
  monolith plan --stage <name>
  monolith deploy --stage <name>

import reads wrangler config and writes .monolith/import/<hash>.json.
Pass --stage on import to seed .monolith/state/<stage>.json from the snapshot.`)
}
