import { loadState } from "@monolith/core"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { runDeploy, type RunWranglerDeploy } from "./deploy.js"
import { runDestroy, type RunWranglerDelete } from "./destroy.js"
import { evaluatePlan } from "./plan.js"
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

/** Future assertion file shape — loaded when present, not yet fully evaluated. */
export interface TestAssertionFile {
  version: number
  assertions?: Array<{
    type: "http"
    path?: string
    url?: string
    expectStatus?: number
    expectBody?: string
  }>
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

export async function runTest(args: string[], options?: TestHarnessOptions): Promise<number> {
  const { stage, destroyAfter } = parseArgs(args)
  if (!stage) {
    return 1
  }
  const projectDir = options?.projectDir ?? process.cwd()
  const httpFetch = options?.httpFetch ?? defaultHttpFetch

  const stateResult = await loadState(stage, projectDir)
  if (!stateResult.ok) {
    console.error(stateResult.error.message)
    console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
    return 1
  }

  const planEval = await evaluatePlan(stage, projectDir)
  if (!planEval.ok) {
    console.error(planEval.message)
    return planEval.exitCode
  }

  if (planEval.value.pending.hasChanges) {
    console.log(`Plan has pending changes for stage "${stage}" — proceeding with deploy (--auto-approve).`)
  } else {
    console.log(`Plan clean for stage "${stage}".`)
  }

  const deployCode = await runDeploy(["--stage", stage, "--auto-approve"], {
    projectDir,
    runWrangler: options?.runWranglerDeploy
  })
  if (deployCode !== 0) {
    return deployCode
  }

  const refreshed = await loadState(stage, projectDir)
  const workerUrl = refreshed.ok ? refreshed.value.workerUrl : stateResult.value.workerUrl
  const testUrl = resolveTestUrl(workerUrl, process.env.MONOLITH_TEST_URL)

  const assertionFile = await loadAssertionFile(projectDir)
  if (assertionFile?.assertions?.length) {
    console.log(`Found ${assertionFile.assertions.length} assertion(s) in ${ASSERTIONS_DIR}/ (future runner — not evaluated yet).`)
  }

  if (testUrl) {
    console.log(`Running HTTP smoke check: ${testUrl}`)
    const smoke = await runHttpSmokeCheck(testUrl, httpFetch)
    if (!smoke.ok) {
      console.error(smoke.message)
      return 1
    }
    console.log("  HTTP smoke passed (2xx).")
  } else {
    console.log("Skipping HTTP smoke (set MONOLITH_TEST_URL or deploy to capture workerUrl in state).")
  }

  if (destroyAfter) {
    console.log("")
    console.log(`Teardown: destroy stage "${stage}" (--destroy-after).`)
    return runDestroy(["--stage", stage, "--auto-approve"], {
      projectDir,
      runWranglerDelete: options?.runWranglerDelete
    })
  }

  console.log("")
  console.log(`Test harness finished for stage "${stage}".`)
  return 0
}
