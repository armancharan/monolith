import { PlanError, StateError } from "@monolith/core"
import {
  CloudflareApiError,
  CloudflareAuthError,
  WranglerError
} from "@monolith/cloudflare"
import { Effect } from "effect"
import { printHelp, runCommand, type CommandName } from "./commands.js"
import { makeMonolithLive } from "./live.js"

const VERSION = "0.3.0"
const argv = process.argv.slice(2)
const first = argv[0]

const handleTaggedError = (error: unknown): number => {
  if (
    error instanceof StateError ||
    error instanceof PlanError ||
    error instanceof CloudflareAuthError ||
    error instanceof CloudflareApiError ||
    error instanceof WranglerError
  ) {
    console.error(error.message)
    return 1
  }

  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  return 1
}

const program = Effect.gen(function* () {
  if (first === "--version" || first === "-v") {
    console.log(VERSION)
    return 0
  }

  if (!first || first === "--help" || first === "-h") {
    printHelp()
    return 0
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
    return 1
  }

  return yield* runCommand(first as CommandName, argv.slice(1))
}).pipe(
  Effect.catch((error) => Effect.succeed(handleTaggedError(error)))
)

const runnable = Effect.provide(program, makeMonolithLive()).pipe(
  Effect.catch((error) => Effect.succeed(handleTaggedError(error)))
) as Effect.Effect<number, never, never>

Effect.runPromise(runnable).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.exit(handleTaggedError(error))
  }
)
