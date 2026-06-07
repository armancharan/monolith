import { printHelp, runCommand, type CommandName } from "./commands.js"

const VERSION = "0.0.0"
const argv = process.argv.slice(2)
const first = argv[0]

async function main(): Promise<void> {
  if (first === "--version" || first === "-v") {
    console.log(VERSION)
    process.exit(0)
  }

  if (!first || first === "--help" || first === "-h") {
    printHelp()
    process.exit(0)
  }

  const known = new Set<CommandName>([
    "init",
    "import",
    "plan",
    "deploy",
    "dev",
    "destroy",
    "test",
    "help",
    "whoami",
    "state",
    "typegen"
  ])
  if (!known.has(first as CommandName)) {
    console.error(`Unknown command: ${first}`)
    printHelp()
    process.exit(1)
  }

  const code = await runCommand(first as CommandName, argv.slice(1))
  process.exit(code)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
