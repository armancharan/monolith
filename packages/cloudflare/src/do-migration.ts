import type { WranglerImportResult } from "./wrangler-import.js"

export interface DoMigrationInfo {
  /** True when config declares new DO classes requiring two-step deploy. */
  requiresTwoStepDeploy: boolean
  migrationTags: string[]
  newClasses: string[]
  newSqliteClasses: string[]
}

export interface WranglerDeployOutcome {
  exitCode: number
  output: string
}

export type RunWranglerDeployFn = (
  projectDir: string,
  configPath?: string
) => Promise<WranglerDeployOutcome>

/**
 * Detect Durable Object migration tags that require Cloudflare's two-step deploy.
 *
 * When `new_classes` or `new_sqlite_classes` appear in a migration block, wrangler
 * must deploy twice: first to register the migration, second to activate bindings.
 */
export function detectDoMigrations(config: WranglerImportResult): DoMigrationInfo {
  const migrations = config.durableObjectMigrations ?? []
  const migrationTags: string[] = []
  const newClasses: string[] = []
  const newSqliteClasses: string[] = []

  for (const migration of migrations) {
    if (migration.tag) {
      migrationTags.push(migration.tag)
    }
    for (const className of migration.newClasses ?? []) {
      if (!newClasses.includes(className)) {
        newClasses.push(className)
      }
    }
    for (const className of migration.newSqliteClasses ?? []) {
      if (!newSqliteClasses.includes(className)) {
        newSqliteClasses.push(className)
      }
    }
  }

  const hasNewClasses = newClasses.length > 0 || newSqliteClasses.length > 0
  const hasDoBindings = config.durableObjects.length > 0

  return {
    requiresTwoStepDeploy: hasNewClasses && hasDoBindings,
    migrationTags,
    newClasses,
    newSqliteClasses
  }
}

/**
 * Run wrangler deploy once or twice when DO migrations require the CF two-step pattern.
 */
export async function deployWithDoMigration(
  projectDir: string,
  configPath: string | undefined,
  deploy: RunWranglerDeployFn,
  config: WranglerImportResult
): Promise<WranglerDeployOutcome> {
  const migration = detectDoMigrations(config)

  if (!migration.requiresTwoStepDeploy) {
    return deploy(projectDir, configPath)
  }

  const first = await deploy(projectDir, configPath)
  if (first.exitCode !== 0) {
    return first
  }

  const second = await deploy(projectDir, configPath)
  if (second.exitCode !== 0) {
    return second
  }

  return {
    exitCode: 0,
    output: `${first.output}\n--- DO migration second deploy ---\n${second.output}`
  }
}
