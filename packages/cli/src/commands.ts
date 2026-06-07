/**
 * M1 CLI commands — C1 import, C2 whoami, C5 state, C6 plan, C7 deploy, C8 typegen wired.
 */
import { runDeploy } from "./deploy.js"
import { runDev } from "./dev.js"
import { runDestroy } from "./destroy.js"
import { runImport } from "./import.js"
import { runPlan } from "./plan.js"
import { runStateInit } from "./state.js"
import { runTest } from "./test.js"
import { runTypegen } from "./typegen.js"
import { runWhoami } from "./whoami.js"

export type CommandName =
  | "init"
  | "import"
  | "plan"
  | "deploy"
  | "dev"
  | "destroy"
  | "test"
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
    case "test":
      return runTest(args)
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
  monolith import <wrangler.toml|wrangler.json|wrangler.jsonc> [--stage <name>] [--preview]
  monolith state init --stage <name> [--from .monolith/import/<hash>.json]
  monolith whoami [--account-id]
  monolith plan [--stage <name>] [--preview] [--cloud] [--no-cloud]
  monolith typegen --stage <name>
  monolith dev [--stage <name>] [--preview]
  monolith deploy [--stage <name>] [--preview] [--auto-approve]
  monolith destroy [--stage <name>] [--preview] [--auto-approve]
  monolith test [--stage <name>] [--preview] [--destroy-after]

import reads wrangler config and writes .monolith/import/<hash>.json.
Pass --stage on import to seed .monolith/state/<stage>.json from the snapshot.
Preview stages use names like pr-123 (state: .monolith/state/pr-123.json).
--preview resolves stage from MONOLITH_PREVIEW_ID or GITHUB_PR_NUMBER (e.g. pr-42).
Preview deploy suffixes the worker name (my-worker-pr-123) via a temp wrangler config.
import and plan also emit src/monolith.env.d.ts (or beside worker main) with MonolithEnv.
plan merges partial cloud drift hints when Cloudflare auth is available (--cloud to require, --no-cloud to skip).
dev runs \`npx wrangler dev\` using project wrangler config or a temp config from state/import.
deploy runs \`npx wrangler deploy\` in the project directory (default stage: dev).
deploy checks plan first; pass --auto-approve to skip when changes are pending.
destroy runs plan, then \`npx wrangler delete <worker>\` when --auto-approve is set.
destroy clears local stage state; D1/KV/R2 buckets are NOT deleted from Cloudflare (bindings only).
test runs plan guard, deploy (--auto-approve), optional HTTP smoke (MONOLITH_TEST_URL or state workerUrl), optional --destroy-after teardown.
Place future assertions in .monolith/test/assertions.json.`)
}
