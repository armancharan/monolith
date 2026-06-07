import { MONOLITH_DIR } from "@monolith/core"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export interface StageVarsFile {
  vars?: Record<string, string>
}

export function stageVarsFilename(stage: string): string {
  return `vars.${stage}.json`
}

export function stageVarsPath(stage: string): string {
  return `${MONOLITH_DIR}/${stageVarsFilename(stage)}`
}

export async function readStageVarsFile(
  stage: string,
  projectDir: string
): Promise<StageVarsFile | undefined> {
  const relativePath = stageVarsPath(stage)
  try {
    const text = await readFile(join(projectDir, relativePath), "utf8")
    return JSON.parse(text) as StageVarsFile
  } catch {
    return undefined
  }
}

export function mergeVarsIntoWranglerConfig(
  config: Record<string, unknown>,
  vars: Record<string, string> | undefined
): Record<string, unknown> {
  if (!vars || Object.keys(vars).length === 0) {
    return config
  }

  const existing =
    config.vars && typeof config.vars === "object" && !Array.isArray(config.vars)
      ? (config.vars as Record<string, string>)
      : {}

  return {
    ...config,
    vars: { ...existing, ...vars }
  }
}
