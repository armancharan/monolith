import { cp, mkdir, access } from "node:fs/promises"
import { constants } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const TEMPLATE_DIR = join(PACKAGE_ROOT, "template")

export interface CreateMonolithOptions {
  targetDir: string
  templateDir?: string
}

export async function directoryIsEmpty(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.F_OK)
    const { readdir } = await import("node:fs/promises")
    const entries = await readdir(dir)
    return entries.length === 0
  } catch {
    return true
  }
}

export async function createMonolithProject(options: CreateMonolithOptions): Promise<void> {
  const targetDir = resolve(options.targetDir)
  const templateDir = options.templateDir ?? TEMPLATE_DIR

  const empty = await directoryIsEmpty(targetDir)
  if (!empty) {
    throw new Error(`Target directory is not empty: ${targetDir}`)
  }

  await mkdir(targetDir, { recursive: true })
  await cp(templateDir, targetDir, { recursive: true })
}

export function parseCreateArgs(argv: string[]): { targetDir: string } {
  const positional = argv.filter((arg) => !arg.startsWith("-"))
  const targetDir = positional[0] ?? "."
  return { targetDir }
}

export function printCreateHelp(): void {
  console.log(`create-monolith — scaffold a Hono Worker with D1 + KV

Usage:
  create-monolith [target-directory]
  npm create monolith [target-directory]

Creates a minimal Monolith-ready project:
  - Hono fetch handler with / and /health routes
  - wrangler.jsonc with D1 + KV binding placeholders
  - README with import/plan/deploy steps

Default target directory: . (current directory; must be empty)`)
}

export async function runCreateMonolith(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printCreateHelp()
    return 0
  }

  const { targetDir } = parseCreateArgs(argv)

  try {
    await createMonolithProject({ targetDir })
    console.log(`Created Monolith project in ${resolve(targetDir)}`)
    console.log("")
    console.log("Next steps:")
    console.log("  1. Replace D1/KV IDs in wrangler.jsonc (wrangler d1 create / kv namespace create)")
    console.log("  2. npm install && npm run dev")
    console.log("  3. monolith import wrangler.jsonc --stage dev")
    console.log("  4. monolith plan --stage dev && monolith deploy --stage dev")
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    return 1
  }
}
