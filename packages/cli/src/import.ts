import {
  formatImportSummary,
  generateMonolithRunTs,
  hashWranglerContent,
  parseWranglerConfigText,
  toImportSnapshot,
  WranglerParseError
} from "@monolith/cloudflare"
import { importSnapshotPath, MONOLITH_DIR, StateStore } from "@monolith/core"
import { Effect } from "effect"
import { mkdir, readFile, writeFile, access } from "node:fs/promises"
import { constants } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { tryPromiseOr } from "./effect-helpers.js"
import { emitTypegenFromImport } from "./typegen.js"
import { parseStageArgs, requireStage } from "./stage.js"

const RUN_FILE = "monolith.run.ts"

function parseImportArgs(args: string[]): {
  configArg?: string
  stage?: string
  preview: boolean
} {
  const stageParsed = parseStageArgs(args)
  const parsed: { configArg?: string; stage?: string; preview: boolean } = {
    stage: stageParsed.stage,
    preview: stageParsed.preview
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith("-") && !parsed.configArg) {
      parsed.configArg = arg
    }
  }

  return parsed
}

export const runImport = (
  args: string[]
): Effect.Effect<number, never, StateStore> =>
  Effect.gen(function* () {
    const stageParsed = parseStageArgs(args)
    const stage = stageParsed.preview
      ? requireStage(
          stageParsed,
          "Usage: monolith import <wrangler.toml|wrangler.json|wrangler.jsonc> [--stage <name>] [--preview]"
        )
      : stageParsed.stage

    const configArg = parseImportArgs(args).configArg
    if (!configArg) {
      console.error(
        "Usage: monolith import <wrangler.toml|wrangler.json|wrangler.jsonc> [--stage <name>] [--preview]"
      )
      return 1
    }

    if (stageParsed.preview && !stage) {
      return 1
    }

    const configPath = resolve(configArg)
    const content = yield* tryPromiseOr(() => readFile(configPath, "utf8"), undefined)
    if (!content) {
      console.error(`Could not read wrangler config: ${configPath}`)
      return 1
    }

    let result
    try {
      result = parseWranglerConfigText(content, configPath)
    } catch (error) {
      const message =
        error instanceof WranglerParseError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error)
      console.error(message)
      return 1
    }

    const projectDir = dirname(configPath)
    const wranglerConfigPath = relative(projectDir, configPath)
    const contentHash = hashWranglerContent(content)
    const snapshot = toImportSnapshot(result, contentHash)
    const importDir = join(projectDir, MONOLITH_DIR, "import")
    const snapshotRelativePath = importSnapshotPath(contentHash)
    const snapshotPath = join(projectDir, snapshotRelativePath)

    yield* tryPromiseOr(async () => {
      await mkdir(importDir, { recursive: true })
      await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
    }, undefined)

    const runPath = join(projectDir, RUN_FILE)
    let generatedRun = false
    const runExists = yield* tryPromiseOr(async () => {
      await access(runPath, constants.F_OK)
      return true
    }, false)

    if (!runExists) {
      yield* tryPromiseOr(() => writeFile(runPath, generateMonolithRunTs(result), "utf8"), undefined)
      generatedRun = true
    }

    console.log(formatImportSummary(result))
    console.log("")
    console.log(`Wrote ${snapshotRelativePath}`)
    if (generatedRun) {
      console.log(`Generated ${RUN_FILE}`)
    } else {
      console.log(`Kept existing ${RUN_FILE} (remove it to regenerate from import)`)
    }

    if (stage) {
      const stateStore = yield* StateStore
      const initFailed = yield* stateStore
        .initStateFromImport(snapshotRelativePath, stage, { wranglerConfigPath })
        .pipe(
          Effect.as(false),
          Effect.catch((error) =>
            Effect.sync(() => {
              console.error(error.message)
              return true
            })
          )
        )
      if (initFailed) {
        return 1
      }
      console.log(`Initialized .monolith/state/${stage}.json`)
    }

    yield* emitTypegenFromImport(projectDir, result)

    return 0
  })
