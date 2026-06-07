import { normalizePreviewStage } from "@monolith/core"

export interface StageArgs {
  stage?: string
  preview: boolean
}

export function resolvePreviewIdFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const explicit = env.MONOLITH_PREVIEW_ID?.trim()
  if (explicit) {
    return normalizePreviewStage(explicit)
  }

  const prNumber = env.GITHUB_PR_NUMBER?.trim()
  if (prNumber) {
    return normalizePreviewStage(prNumber)
  }

  return undefined
}

export function parseStageArgs(
  args: string[],
  options?: { defaultStage?: string }
): StageArgs {
  const parsed: StageArgs = { preview: false }
  let explicitStage: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--stage" && args[index + 1]) {
      explicitStage = args[index + 1]
      index += 1
      continue
    }
    if (arg === "--preview") {
      parsed.preview = true
    }
  }

  if (explicitStage) {
    parsed.stage = explicitStage
  } else if (parsed.preview) {
    parsed.stage = resolvePreviewIdFromEnv()
  } else if (options?.defaultStage) {
    parsed.stage = options.defaultStage
  }

  return parsed
}

export function requireStage(
  parsed: StageArgs,
  usage: string,
  previewHint = "Set MONOLITH_PREVIEW_ID or GITHUB_PR_NUMBER, or pass --stage pr-<number>."
): string | undefined {
  if (parsed.stage) {
    return parsed.stage
  }

  if (parsed.preview) {
    console.error(`--preview requires a preview id. ${previewHint}`)
  } else {
    console.error(usage)
  }

  return undefined
}
