import {
  bindingEntriesFromImportResult,
  bindingEntriesFromStateResources,
  envTypesRelativePath,
  generateMonolithEnvDts,
  parseWranglerConfigText,
  type WranglerImportResult
} from "@monolith/cloudflare"
import { StateStore, type MonolithState } from "@monolith/core"
import { Effect } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tryPromiseOr } from "./effect-helpers.js"

function parseArgs(args: string[]): { stage?: string } {
  const parsed: { stage?: string } = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--stage" && args[index + 1]) {
      parsed.stage = args[index + 1]
      index += 1
    }
  }

  return parsed
}

const resolveImportResult = (
  state: MonolithState,
  projectDir: string
): Effect.Effect<WranglerImportResult | undefined, never> =>
  Effect.gen(function* () {
    if (!state.wranglerConfigPath) {
      return undefined
    }

    const configPath = join(projectDir, state.wranglerConfigPath)
    const content = yield* tryPromiseOr(() => readFile(configPath, "utf8"), undefined)
    if (!content) {
      return undefined
    }

    try {
      return parseWranglerConfigText(content, state.wranglerConfigPath)
    } catch {
      return undefined
    }
  })

export const writeMonolithEnvTypes = (
  projectDir: string,
  result: WranglerImportResult
): Effect.Effect<string, never> =>
  Effect.gen(function* () {
    const relativePath = envTypesRelativePath(result.main)
    const content = generateMonolithEnvDts(bindingEntriesFromImportResult(result))
    const absolutePath = join(projectDir, relativePath)

    yield* tryPromiseOr(async () => {
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, content, "utf8")
    }, undefined)

    return relativePath
  })

export const writeMonolithEnvTypesFromState = (
  projectDir: string,
  state: MonolithState,
  mainEntry: string
): Effect.Effect<string, never> =>
  Effect.gen(function* () {
    const relativePath = envTypesRelativePath(mainEntry)
    const content = generateMonolithEnvDts(bindingEntriesFromStateResources(state.resources))
    const absolutePath = join(projectDir, relativePath)

    yield* tryPromiseOr(async () => {
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, content, "utf8")
    }, undefined)

    return relativePath
  })

export const emitTypegenFromImport = (
  projectDir: string,
  result: WranglerImportResult
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const relativePath = yield* writeMonolithEnvTypes(projectDir, result)
    console.log(`Wrote ${relativePath}`)
  })

export const runTypegen = (
  args: string[]
): Effect.Effect<number, never, StateStore> =>
  Effect.gen(function* () {
    const { stage } = parseArgs(args)
    if (!stage) {
      console.error("Usage: monolith typegen --stage <name>")
      return 1
    }

    const projectDir = process.cwd()
    const stateStore = yield* StateStore
    const state = yield* stateStore.loadState(stage).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
          return 1
        })
      )
    )

    if (typeof state === "number") {
      return state
    }

    const importResult = yield* resolveImportResult(state, projectDir)
    if (importResult) {
      yield* emitTypegenFromImport(projectDir, importResult)
      return 0
    }

    const mainEntry = "src/index.ts"
    const relativePath = yield* writeMonolithEnvTypesFromState(projectDir, state, mainEntry)
    console.log(`Wrote ${relativePath}`)
    return 0
  })
