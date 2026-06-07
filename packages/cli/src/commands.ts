/**
 * M1 CLI commands — C1 import, C2 whoami, C5 state, C6 plan, C7 deploy, C8 typegen wired.
 */
import { runDeploy } from "./deploy.js"
import { runDev } from "./dev.js"
import { runDestroy } from "./destroy.js"
import { runImport } from "./import.js"
import { runPlan } from "./plan.js"
import { runStateInit } from "./state.js"
import { runTypegen } from "./typegen.js"
import { runWhoami } from "./whoami.js"

export type CommandName =
  | "init"
  | "import"
  | "plan"
  | "deploy"
  | "dev"
  | "destroy"
  | "help"
  | "whoami"
  | "state"
  | "typegen"

export async function runCommand(name: CommandName, args: string[]): Promise<number> {
  switch (name) {
    case "init":
      console.log("monolith init — not implemented (C0 scaffold)")
      return 0
    case "import":
      return runImport(args)
    case "plan":
      return runPlan(args)
    case "deploy":
      return runDeploy(args)
    case "dev":
      return runDev(args)
    case "destroy":
      return runDestroy(args)
    case "whoami":
      return runWhoami(args)
    case "state":
      if (args[0] === "init") {
        return runStateInit(args.slice(1))
      }
      console.error("Usage: monolith state init --stage <name> [--from <import.json>]")
      return 1
    case "typegen":
      return runTypegen(args)
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
  monolith plan --stage <name> [--cloud] [--no-cloud]
  monolith typegen --stage <name>
  monolith dev [--stage <name>]
  monolith deploy [--stage <name>] [--auto-approve]
  monolith destroy [--stage <name>]

import reads wrangler config and writes .monolith/import/<hash>.json.
Pass --stage on import to seed .monolith/state/<stage>.json from the snapshot.
import and plan also emit src/monolith.env.d.ts (or beside worker main) with MonolithEnv.
plan merges partial cloud drift hints when Cloudflare auth is available (--cloud to require, --no-cloud to skip).
dev runs \`npx wrangler dev\` using project wrangler config or a temp config from state/import.
deploy runs \`npx wrangler deploy\` in the project directory (default stage: dev).
deploy checks plan first; pass --auto-approve to skip when changes are pending.
destroy is an M1 stub — full teardown deferred post-M1.`)
}
