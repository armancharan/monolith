/**
 * C0 command stubs — C9 wires these to import/plan/deploy engines.
 */
export type CommandName = "init" | "import" | "plan" | "deploy" | "help"

export function runCommand(name: CommandName, _args: string[]): number {
  switch (name) {
    case "init":
      console.log("monolith init — not implemented (C0 scaffold)")
      return 0
    case "import":
      console.log("monolith import — not implemented (C1 wrangler parser next)")
      return 0
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
  monolith import <wrangler.toml|wrangler.jsonc>
  monolith plan --stage <name>
  monolith deploy --stage <name>

Commands are stubs until C1+ land.`)
}
