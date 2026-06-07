/** Preview stages use `pr-<number>` namespacing (state file + worker suffix). */
const PREVIEW_STAGE_PATTERN = /^pr-\d+$/

export function isPreviewStage(stage: string): boolean {
  return PREVIEW_STAGE_PATTERN.test(stage)
}

export function normalizePreviewStage(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }
  return trimmed.startsWith("pr-") ? trimmed : `pr-${trimmed}`
}

export function previewWorkerName(baseName: string, stage: string): string {
  if (!isPreviewStage(stage)) {
    return baseName
  }
  const suffix = `-${stage}`
  if (baseName.endsWith(suffix)) {
    return baseName
  }
  return `${baseName}${suffix}`
}
