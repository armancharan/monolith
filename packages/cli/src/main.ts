import { printHelp, runCommand, type CommandName } from "./commands.js"

const VERSION = "0.0.0"
const argv = process.argv.slice(2)
const first = argv[0]

if (first === "--version" || first === "-v") {
  console.log(VERSION)
  process.exit(0)
}

if (!first || first === "--help" || first === "-h") {
  printHelp()
  process.exit(0)
}

const known = new Set<CommandName>(["init", "import", "plan", "deploy", "help"])
if (!known.has(first as CommandName)) {
  console.error(`Unknown command: ${first}`)
  printHelp()
  process.exit(1)
}

process.exit(runCommand(first as CommandName, argv.slice(1)))
