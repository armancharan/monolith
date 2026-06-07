/**
 * M1 CLI commands — import, plan, deploy, dev, test, state, typegen wired.
 */
import { CloudflareClient, WranglerDeployer } from "@monolith/cloudflare"
import { ReconcileProgram, StateStore } from "@monolith/core"
import { Effect } from "effect"

export type CommandServices = StateStore | ReconcileProgram | WranglerDeployer | CloudflareClient
import { runDeploy } from "./deploy.js"
import { runDev } from "./dev.js"
import { runDestroy } from "./destroy.js"
import { runImport } from "./import.js"
import { runPlan } from "./plan.js"
import { runStateInit } from "./state.js"
import { runStatePull, runStatePush } from "./state-remote.js"
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

export const runCommand = (
  name: CommandName,
  args: string[]
): Effect.Effect<number, never, CommandServices> =>
  Effect.gen(function* () {
    switch (name) {
      case "init":
        console.log("monolith init — not implemented (C0 scaffold)")
        return 0
      case "import":
        return yield* runImport(args)
      case "plan":
        return yield* runPlan(args)
      case "deploy":
        return yield* runDeploy(args)
      case "dev":
        return yield* runDev(args)
      case "destroy":
        return yield* runDestroy(args)
      case "test":
        return yield* runTest(args)
      case "whoami":
        return yield* runWhoami(args)
      case "state":
        if (args[0] === "init") {
          return yield* runStateInit(args.slice(1))
        }
        if (args[0] === "pull") {
          return yield* runStatePull(args.slice(1))
        }
        if (args[0] === "push") {
          return yield* runStatePush(args.slice(1))
        }
        console.error(
          "Usage: monolith state init|pull|push --stage <name> [--from <import.json>] [--preview]"
        )
        return 1
      case "typegen":
        return yield* runTypegen(args)
      case "help":
        printHelp()
        return 0
    }
  })

export function printHelp(): void {
  console.log(`monolith — TypeScript IaC for Cloudflare Workers (M1)

Usage:
  monolith init
  monolith import <wrangler.toml|wrangler.json|wrangler.jsonc> [--stage <name>] [--preview]
  monolith state init --stage <name> [--from .monolith/import/<hash>.json]
  monolith state pull --stage <name>   # remote R2 backend (MONOLITH_STATE_BACKEND=r2)
  monolith state push --stage <name>
  monolith whoami [--account-id]
  monolith plan [--stage <name>] [--preview] [--cloud] [--no-cloud]
  monolith typegen --stage <name>
  monolith dev [--stage <name>] [--preview] [--watch]
  monolith deploy [--stage <name>] [--preview] [--auto-approve] [--ensure-resources]
  monolith destroy [--stage <name>] [--preview] [--auto-approve]
  monolith test [--stage <name>] [--preview] [--destroy-after]

import reads wrangler config and writes .monolith/import/<hash>.json.
Pass --stage on import to seed .monolith/state/<stage>.json from the snapshot.
Preview stages use names like pr-123 (state: .monolith/state/pr-123.json).
--preview resolves stage from MONOLITH_PREVIEW_ID or GITHUB_PR_NUMBER (e.g. pr-42).
Preview deploy suffixes the worker name (my-worker-pr-123) via a temp wrangler config.
Per-stage wrangler vars: .monolith/vars.<stage>.json (merged at deploy/dev).
import and plan also emit src/monolith.env.d.ts (or beside worker main) with MonolithEnv.
plan merges partial cloud drift hints when Cloudflare auth is available (--cloud to require, --no-cloud to skip).
dev runs \`npx wrangler dev\` using project wrangler config or a temp config from state/import.
deploy runs \`npx wrangler deploy\` in the project directory (default stage: dev).
deploy checks plan first; pass --auto-approve to skip when changes are pending.
deploy with --ensure-resources (or auto when wrangler has REPLACE_* IDs) runs wrangler d1/kv create before deploy.
destroy runs plan, then \`npx wrangler delete <worker>\` when --auto-approve is set.
destroy clears local stage state; D1/KV/R2 buckets are NOT deleted from Cloudflare (bindings only).
test runs plan guard, deploy (--auto-approve), route assertions (.monolith/test/assertions.json), optional HTTP smoke, optional --destroy-after teardown.
Remote state (optional): MONOLITH_STATE_BACKEND=r2, MONOLITH_STATE_R2_BUCKET, R2 API credentials.`)
}
