import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"

const DOGFOOD_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../cloudflare/tests/fixtures/dogfood-wrangler.jsonc"
)

export async function createFixtureProject(): Promise<string> {
  const projectDir = join(tmpdir(), `monolith-integration-${Date.now()}-${Math.random()}`)
  await mkdir(join(projectDir, "src"), { recursive: true })
  await copyFile(DOGFOOD_FIXTURE, join(projectDir, "wrangler.jsonc"))
  await writeFile(join(projectDir, "src", "index.ts"), `export default { fetch() { return new Response("ok") } }\n`)
  return projectDir
}

export async function readState(projectDir: string, stage: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(projectDir, ".monolith", "state", `${stage}.json`), "utf8"))
}

export async function listImportSnapshots(projectDir: string): Promise<string[]> {
  const importDir = join(projectDir, ".monolith", "import")
  const entries = await readdir(importDir)
  return entries.filter((entry) => entry.endsWith(".json"))
}
