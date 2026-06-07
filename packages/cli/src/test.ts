import { StateStore } from "@monolith/core"
import { Effect } from "effect"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  evaluateRouteAssertions,
  normalizeAssertionRoutes,
  type TestAssertionFile
} from "./assertions.js"
import { runDeploy, type RunWranglerDeploy } from "./deploy.js"
import { runDestroy, type RunWranglerDelete } from "./destroy.js"
import { evaluatePlan } from "./plan.js"
import { tryPromiseOr } from "./effect-helpers.js"
import { parseStageArgs, requireStage } from "./stage.js"

const DEFAULT_STAGE = "dev"
const ASSERTIONS_DIR = ".monolith/test"

export interface TestArgs {
  stage: string
  destroyAfter: boolean
}

export interface HttpFetchResult {
  status: number
  body?: string
}

export type HttpFetch = (url: string) => Promise<HttpFetchResult>

export interface TestHarnessOptions {
  projectDir?: string
  runWranglerDeploy?: RunWranglerDeploy
  runWranglerDelete?: RunWranglerDelete
  httpFetch?: HttpFetch
}

function parseArgs(args: string[]): TestArgs & { preview: boolean } {
  const stageParsed = parseStageArgs(args, { defaultStage: DEFAULT_STAGE })
  const stage = requireStage(
    stageParsed,
    "Usage: monolith test [--stage <name>] [--preview] [--destroy-after]"
  )

  return {
    stage: stage ?? "",
    preview: stageParsed.preview,
    destroyAfter: args.includes("--destroy-after")
  }
}

export async function loadAssertionFile(projectDir: string): Promise<TestAssertionFile | undefined> {
  const candidates = ["assertions.json", "assertions.example.json"]
  for (const name of candidates) {
    try {
      const text = await readFile(join(projectDir, ASSERTIONS_DIR, name), "utf8")
      return JSON.parse(text) as TestAssertionFile
    } catch {
      // try next candidate
    }
  }
  return undefined
}

export function resolveTestUrl(
  stateWorkerUrl: string | undefined,
  envUrl: string | undefined
): string | undefined {
  return envUrl ?? stateWorkerUrl
}

export async function defaultHttpFetch(url: string): Promise<HttpFetchResult> {
  const response = await fetch(url, { redirect: "follow" })
  const body = await response.text()
  return { status: response.status, body }
}

export async function runHttpSmokeCheck(
  url: string,
  fetchImpl: HttpFetch
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const result = await fetchImpl(url)
    if (result.status < 200 || result.status >= 300) {
      return {
        ok: false,
        message: `HTTP smoke failed for ${url}: expected 2xx, got ${result.status}`
      }
    }
    return { ok: true }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, message: `HTTP smoke failed for ${url}: ${message}` }
  }
}

export const runTest = (
  args: string[],
  options?: TestHarnessOptions
): Effect.Effect<
  number,
  never,
  import("./commands.js").CommandServices
> =>
  Effect.gen(function* () {
    const { stage, destroyAfter } = parseArgs(args)
    if (!stage) {
      return 1
    }
    const projectDir = options?.projectDir ?? process.cwd()
    const httpFetch = options?.httpFetch ?? defaultHttpFetch
    const stateStore = yield* StateStore

    const initialState = yield* stateStore.loadState(stage).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
          return 1
        })
      )
    )

    if (typeof initialState === "number") {
      return initialState
    }

    const planEval = yield* evaluatePlan(stage, projectDir).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message)
          return 1
        })
      )
    )

    if (typeof planEval === "number") {
      return planEval
    }

    if (planEval.pending.hasChanges) {
      console.log(
        `Plan has pending changes for stage "${stage}" — proceeding with deploy (--auto-approve).`
      )
    } else {
      console.log(`Plan clean for stage "${stage}".`)
    }

    const deployCode = yield* runDeploy(["--stage", stage, "--auto-approve"], {
      projectDir,
      runWrangler: options?.runWranglerDeploy
    })

    if (deployCode !== 0) {
      return deployCode
    }

    const refreshed = yield* stateStore.loadState(stage).pipe(Effect.result)
    const workerUrl = refreshed._tag === "Success" ? refreshed.success.workerUrl : initialState.workerUrl
    const testUrl = resolveTestUrl(workerUrl, process.env.MONOLITH_TEST_URL)

    const assertionFile = yield* tryPromiseOr(() => loadAssertionFile(projectDir), undefined)
    const routes = assertionFile ? normalizeAssertionRoutes(assertionFile) : []

    if (routes.length > 0) {
      if (!testUrl) {
        console.error(
          "Assertions require a worker URL. Deploy must capture workerUrl in state or set MONOLITH_TEST_URL."
        )
        return 1
      }

      console.log(`Running ${routes.length} route assertion(s) from ${ASSERTIONS_DIR}/assertions.json:`)
      const assertionResult = yield* tryPromiseOr(
        () => evaluateRouteAssertions(testUrl, routes, httpFetch),
        { ok: false as const, message: "assertion failed" }
      )
      if (!assertionResult.ok) {
        console.error(assertionResult.message)
        return 1
      }
      console.log("  Route assertions passed.")
    } else if (testUrl) {
      console.log(`Running HTTP smoke check: ${testUrl}`)
      const smoke = yield* tryPromiseOr(
        () => runHttpSmokeCheck(testUrl, httpFetch),
        { ok: false as const, message: "smoke check failed" }
      )
      if (!smoke.ok) {
        console.error(smoke.message)
        return 1
      }
      console.log("  HTTP smoke passed (2xx).")
    } else {
      console.log("Skipping HTTP checks (set MONOLITH_TEST_URL or deploy to capture workerUrl in state).")
    }

    if (destroyAfter) {
      console.log("")
      console.log(`Teardown: destroy stage "${stage}" (--destroy-after).`)
      return yield* runDestroy(["--stage", stage, "--auto-approve"], {
        projectDir,
        runWranglerDelete: options?.runWranglerDelete
      })
    }

    console.log("")
    console.log(`Test harness finished for stage "${stage}".`)
    return 0
  })

export type { TestAssertionFile } from "./assertions.js"
