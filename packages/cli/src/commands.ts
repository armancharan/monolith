/**
 * M1 CLI commands — C1 import wired; C9 wires plan/deploy engines.
 */
import { runImport } from "./import.js"

export type CommandName = "init" | "import" | "plan" | "deploy" | "help"

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
    case "help":
      printHelp()
      return 0
  }
}

export function printHelp(): void {
  console.log(`monolith — TypeScript IaC for Cloudflare Workers (M1)

Usage:
  monolith init
  monolith import <wrangler.toml|wrangler.json|wrangler.jsonc>
  monolith plan --stage <name>
  monolith deploy --stage <name>

import reads wrangler config and writes .monolith/import/<hash>.json.`)
}
