import {
  formatImportSummary,
  generateMonolithRunTs,
  hashWranglerContent,
  parseWranglerConfigText,
  toImportSnapshot,
  WranglerParseError
} from "@monolith/cloudflare"
import { importSnapshotPath, MONOLITH_DIR } from "@monolith/core"
import { mkdir, readFile, writeFile, access } from "node:fs/promises"
import { constants } from "node:fs"
import { dirname, join, resolve } from "node:path"

const RUN_FILE = "monolith.run.ts"

export async function runImport(args: string[]): Promise<number> {
  const configArg = args[0]
  if (!configArg) {
    console.error("Usage: monolith import <wrangler.toml|wrangler.json|wrangler.jsonc>")
    return 1
  }

  const configPath = resolve(configArg)
  let content: string
  try {
    content = await readFile(configPath, "utf8")
  } catch {
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
  const contentHash = hashWranglerContent(content)
  const snapshot = toImportSnapshot(result, contentHash)
  const importDir = join(projectDir, MONOLITH_DIR, "import")
  const snapshotRelativePath = importSnapshotPath(contentHash)
  const snapshotPath = join(projectDir, snapshotRelativePath)

  await mkdir(importDir, { recursive: true })
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")

  const runPath = join(projectDir, RUN_FILE)
  let generatedRun = false
  try {
    await access(runPath, constants.F_OK)
  } catch {
    await writeFile(runPath, generateMonolithRunTs(result), "utf8")
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

  return 0
}
