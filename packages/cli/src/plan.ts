import {
  formatCloudPlan,
  formatPlan,
  IMPORT_DIR,
  PlanError,
  ReconcileProgram,
  StateError,
  StateStore,
  stateFromImportSnapshot,
  type ImportSnapshot,
  type MonolithState,
  type PlanDesiredSource,
  type PlanResult
} from "@monolith/core"
import {
  buildCloudDriftHints,
  formatCloudDriftHints,
  hashWranglerContent,
  parseWranglerConfigText,
  readActualStack,
  readCloudWorker,
  toImportSnapshot,
  WranglerParseError
} from "@monolith/cloudflare"
import { Effect } from "effect"
import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { emitTypegenFromImport } from "./typegen.js"
import { loadDesiredFromStackFile, stackFileExists } from "./stack-file.js"
import { tryPromiseOr } from "./effect-helpers.js"
import { parseStageArgs, requireStage } from "./stage.js"

export type DesiredSource = PlanDesiredSource

export type CloudPlanMode = "auto" | "on" | "off"

function parseArgs(args: string[]): {
  stage?: string
  cloud: CloudPlanMode
  localOnly: boolean
  preview: boolean
} {
  const stageParsed = parseStageArgs(args)
  const parsed: {
    stage?: string
    cloud: CloudPlanMode
    localOnly: boolean
    preview: boolean
  } = {
    stage: stageParsed.stage,
    cloud: "auto",
    localOnly: false,
    preview: stageParsed.preview
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--cloud") {
      parsed.cloud = "on"
    }
    if (arg === "--no-cloud") {
      parsed.cloud = "off"
    }
    if (arg === "--local-only") {
      parsed.localOnly = true
      parsed.cloud = "off"
    }
  }

  return parsed
}

const readImportSnapshot = (
  importPath: string,
  projectDir: string
): Effect.Effect<ImportSnapshot | undefined, never> =>
  tryPromiseOr(async () => {
    const text = await readFile(join(projectDir, importPath), "utf8")
    return JSON.parse(text) as ImportSnapshot
  }, undefined)

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

const snapshotFromWrangler = (
  current: MonolithState,
  projectDir: string
): Effect.Effect<ImportSnapshot | undefined, PlanError> =>
  Effect.gen(function* () {
    if (!current.wranglerConfigPath) {
      return undefined
    }

    const configPath = join(projectDir, current.wranglerConfigPath)
    const content = yield* tryPromiseOr(() => readFile(configPath, "utf8"), undefined)
    if (!content) {
      return undefined
    }

    try {
      const parsed = parseWranglerConfigText(content, configPath)
      return toImportSnapshot(parsed, hashWranglerContent(content))
    } catch (error) {
      if (error instanceof WranglerParseError) {
        return undefined
      }
      return yield* Effect.fail(
        new PlanError({
          message: error instanceof Error ? error.message : String(error)
        })
      )
    }
  })

const snapshotFromImport = (
  current: MonolithState,
  projectDir: string
): Effect.Effect<{ snapshot: ImportSnapshot; path: string } | undefined, never> =>
  Effect.gen(function* () {
    const importCandidates = [
      current.importSnapshotPath,
      current.importHash ? `${IMPORT_DIR}/${current.importHash}.json` : undefined,
      yield* latestImportSnapshot(projectDir)
    ].filter((value): value is string => Boolean(value))

    for (const importPath of importCandidates) {
      const snapshot = yield* readImportSnapshot(importPath, projectDir)
      if (snapshot) {
        return { snapshot, path: importPath }
      }
    }

    return undefined
  })

/**
 * Resolve desired state for plan/deploy.
 *
 * Precedence:
 * 1. monolith.run.ts merged with wrangler/import snapshot (when run file + base snapshot exist)
 * 2. wrangler config re-parse
 * 3. import snapshot
 */
export const resolveDesiredState = (
  current: MonolithState,
  projectDir: string
): Effect.Effect<{ state: MonolithState; source: DesiredSource } | undefined, PlanError> =>
  Effect.gen(function* () {
    const wranglerSnapshot = yield* snapshotFromWrangler(current, projectDir)
    const importResult = yield* snapshotFromImport(current, projectDir)
    const baseSnapshot = wranglerSnapshot ?? importResult?.snapshot

    if (baseSnapshot && (yield* tryPromiseOr(() => stackFileExists(projectDir), false))) {
      const stackState = yield* tryPromiseOr(
        () => loadDesiredFromStackFile(projectDir, current, baseSnapshot),
        undefined
      )
      if (stackState) {
        return { state: stackState, source: "stack" }
      }
    }

    if (wranglerSnapshot && current.wranglerConfigPath) {
      return {
        state: stateFromImportSnapshot(wranglerSnapshot, current.stage, {
          importSnapshotPath: current.importSnapshotPath,
          wranglerConfigPath: current.wranglerConfigPath
        }),
        source: "wrangler"
      }
    }

    if (importResult) {
      return {
        state: stateFromImportSnapshot(importResult.snapshot, current.stage, {
          importSnapshotPath: importResult.path,
          wranglerConfigPath: current.wranglerConfigPath
        }),
        source: "import"
      }
    }

    return undefined
  })

export interface CloudActualResult {
  actual?: MonolithState
  drift?: PlanResult
  skippedReason?: string
}

export const resolveCloudActual = (
  persisted: MonolithState,
  desired: MonolithState,
  projectDir: string,
  cloudMode: CloudPlanMode
): Effect.Effect<CloudActualResult | undefined, never, ReconcileProgram> =>
  Effect.gen(function* () {
    if (cloudMode === "off") {
      return undefined
    }

    const actualResult = yield* readActualStack({
      state: persisted,
      projectDir
    }).pipe(Effect.result)

    if (actualResult._tag === "Failure") {
      const message =
        typeof actualResult.failure === "string"
          ? actualResult.failure
          : actualResult.failure.message
      if (cloudMode === "on") {
        return { skippedReason: message }
      }
      return undefined
    }

    const actual = actualResult.success
    const reconcile = yield* ReconcileProgram
    const drift = yield* reconcile.evaluate(actual, desired, "import")
    return { actual, drift }
  })

export const resolveCloudDrift = (
  current: MonolithState,
  projectDir: string,
  cloudMode: CloudPlanMode,
  configPath?: string
): Effect.Effect<ReturnType<typeof buildCloudDriftHints> | undefined, never> =>
  Effect.gen(function* () {
    if (cloudMode === "off") {
      return undefined
    }

    const readResult = yield* readCloudWorker({
      state: current,
      projectDir,
      configPath
    }).pipe(Effect.result)

    if (readResult._tag === "Failure") {
      if (cloudMode === "on") {
        const message =
          typeof readResult.failure === "string"
            ? readResult.failure
            : readResult.failure.message
        return {
          hints: [],
          skippedReason: message
        }
      }
      return undefined
    }

    return buildCloudDriftHints(current, readResult.success)
  })

export interface EvaluatePlanResult {
  current: MonolithState
  desired: MonolithState
  desiredSource: DesiredSource
  pending: PlanResult
  cloud?: CloudActualResult
}

export const evaluatePlan = (
  stage: string,
  projectDir: string,
  options?: { cloudMode?: CloudPlanMode }
): Effect.Effect<EvaluatePlanResult, StateError | PlanError, StateStore | ReconcileProgram> =>
  Effect.gen(function* () {
    const stateStore = yield* StateStore
    const reconcile = yield* ReconcileProgram
    const current = yield* stateStore.loadState(stage)

    const desiredResult = yield* resolveDesiredState(current, projectDir)
    if (!desiredResult) {
      return yield* Effect.fail(
        new PlanError({
          message:
            "Could not resolve desired state from monolith.run.ts, wrangler config, or import snapshot."
        })
      )
    }

    const pending = yield* reconcile.evaluate(
      current,
      desiredResult.state,
      desiredResult.source
    )

    const cloudMode = options?.cloudMode ?? "auto"
    const cloud = yield* resolveCloudActual(
      current,
      desiredResult.state,
      projectDir,
      cloudMode
    )

    return {
      current,
      desired: desiredResult.state,
      desiredSource: desiredResult.source,
      pending,
      cloud
    }
  })

export const runPlan = (
  args: string[],
  options?: { projectDir?: string }
): Effect.Effect<number, never, StateStore | ReconcileProgram> =>
  Effect.gen(function* () {
    const { stage: parsedStage, cloud, localOnly, preview } = parseArgs(args)
    const stage = requireStage(
      { stage: parsedStage, preview },
      "Usage: monolith plan --stage <name> [--preview] [--cloud] [--no-cloud] [--local-only]"
    )
    if (!stage) {
      return 1
    }

    const projectDir = options?.projectDir ?? process.cwd()
    const evaluated = yield* evaluatePlan(stage, projectDir, { cloudMode: cloud }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          if (error.message.includes("State file not found")) {
            console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
          }
          return 1
        })
      )
    )

    if (typeof evaluated === "number") {
      return evaluated
    }

    const { current, desiredSource, pending, cloud: cloudActual } = evaluated

    let output: string
    if (localOnly || !cloudActual) {
      output = formatPlan(stage, current, pending)
    } else {
      output = formatCloudPlan(stage, current.stackName, {
        desiredSource,
        drift: cloudActual.drift,
        pending,
        cloudSkippedReason: cloudActual.skippedReason
      })
    }

    const configPath = current.wranglerConfigPath
    const cloudDrift = yield* resolveCloudDrift(current, projectDir, cloud, configPath)
    if (cloudDrift && !localOnly) {
      output += formatCloudDriftHints(cloudDrift)
    }

    console.log(output)

    if (current.wranglerConfigPath) {
      const typegenResult = yield* tryPromiseOr(async () => {
        const absoluteConfigPath = join(projectDir, current.wranglerConfigPath!)
        const content = await readFile(absoluteConfigPath, "utf8")
        return parseWranglerConfigText(content, current.wranglerConfigPath!)
      }, undefined)
      if (typegenResult) {
        yield* emitTypegenFromImport(projectDir, typegenResult)
      }
    }

    return 0
  })
