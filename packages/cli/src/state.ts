import { IMPORT_DIR, StateStore } from "@monolith/core"
import { tryPromiseOr } from "./effect-helpers.js"
import { Effect } from "effect"
import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"

function parseArgs(args: string[]): {
  stage?: string
  from?: string
} {
  const parsed: { stage?: string; from?: string } = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--stage" && args[index + 1]) {
      parsed.stage = args[index + 1]
      index += 1
      continue
    }
    if (arg === "--from" && args[index + 1]) {
      parsed.from = args[index + 1]
      index += 1
    }
  }

  return parsed
}

const latestImportSnapshot = (
  projectDir: string
): Effect.Effect<string | undefined, never> =>
  Effect.gen(function* () {
    const importDir = join(projectDir, IMPORT_DIR)
    const entries = yield* tryPromiseOr(() => readdir(importDir), [] as string[])

    const jsonFiles = entries.filter((entry) => entry.endsWith(".json"))
    if (jsonFiles.length === 0) {
      return undefined
    }

    let latestPath: string | undefined
    let latestMtime = 0

    for (const file of jsonFiles) {
      const filePath = join(importDir, file)
      const fileStat = yield* tryPromiseOr(() => stat(filePath), undefined)
      if (fileStat && fileStat.mtimeMs >= latestMtime) {
        latestMtime = fileStat.mtimeMs
        latestPath = `${IMPORT_DIR}/${file}`
      }
    }

    return latestPath
  })

export const runStateInit = (
  args: string[]
): Effect.Effect<number, never, StateStore> =>
  Effect.gen(function* () {
    const { stage, from } = parseArgs(args)
    if (!stage) {
      console.error("Usage: monolith state init --stage <name> [--from .monolith/import/<hash>.json]")
      return 1
    }

    const projectDir = process.cwd()
    const importPath = from ?? (yield* latestImportSnapshot(projectDir))
    if (!importPath) {
      console.error("No import snapshot found. Run `monolith import` first or pass --from.")
      return 1
    }

    const stateStore = yield* StateStore
    const state = yield* stateStore.initStateFromImport(importPath, stage).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return 1
        })
      )
    )

    if (typeof state === "number") {
      return state
    }

    console.log(`Initialized state for stage "${stage}"`)
    console.log(`  Stack: ${state.stackName}`)
    console.log(`  Resources: ${state.resources.length}`)
    console.log(`  Import hash: ${state.importHash ?? "(none)"}`)
    console.log(`  Wrote .monolith/state/${stage}.json`)

    return 0
  })
