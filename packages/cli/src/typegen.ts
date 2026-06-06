import {
  bindingEntriesFromImportResult,
  bindingEntriesFromStateResources,
  envTypesRelativePath,
  generateMonolithEnvDts,
  parseWranglerConfigText,
  type WranglerImportResult
} from "@monolith/cloudflare"
import { loadState, type MonolithState } from "@monolith/core"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

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

async function resolveImportResult(
  state: MonolithState,
  projectDir: string
): Promise<WranglerImportResult | undefined> {
  if (state.wranglerConfigPath) {
    const configPath = join(projectDir, state.wranglerConfigPath)
    try {
      const content = await readFile(configPath, "utf8")
      return parseWranglerConfigText(content, configPath)
    } catch {
      return undefined
    }
  }

  return undefined
}

export async function writeMonolithEnvTypes(
  projectDir: string,
  result: WranglerImportResult
): Promise<string> {
  const relativePath = envTypesRelativePath(result.main)
  const content = generateMonolithEnvDts(bindingEntriesFromImportResult(result))
  const absolutePath = join(projectDir, relativePath)

  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, "utf8")

  return relativePath
}

export async function writeMonolithEnvTypesFromState(
  projectDir: string,
  state: MonolithState,
  mainEntry: string
): Promise<string> {
  const relativePath = envTypesRelativePath(mainEntry)
  const content = generateMonolithEnvDts(bindingEntriesFromStateResources(state.resources))
  const absolutePath = join(projectDir, relativePath)

  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, "utf8")

  return relativePath
}

export async function emitTypegenFromImport(
  projectDir: string,
  result: WranglerImportResult
): Promise<void> {
  const relativePath = await writeMonolithEnvTypes(projectDir, result)
  console.log(`Wrote ${relativePath}`)
}

export async function runTypegen(args: string[]): Promise<number> {
  const { stage } = parseArgs(args)
  if (!stage) {
    console.error("Usage: monolith typegen --stage <name>")
    return 1
  }

  const projectDir = process.cwd()
  const stateResult = await loadState(stage, projectDir)
  if (!stateResult.ok) {
    console.error(stateResult.error.message)
    console.error("Run `monolith import ... --stage <name>` or `monolith state init` first.")
    return 1
  }

  const state = stateResult.value
  const importResult = await resolveImportResult(state, projectDir)
  if (importResult) {
    await emitTypegenFromImport(projectDir, importResult)
    return 0
  }

  const mainEntry = "src/index.ts"
  const relativePath = await writeMonolithEnvTypesFromState(projectDir, state, mainEntry)
  console.log(`Wrote ${relativePath}`)
  return 0
}
