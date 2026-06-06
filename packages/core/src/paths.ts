export const MONOLITH_DIR = ".monolith"

export const STATE_DIR = `${MONOLITH_DIR}/state`

export const IMPORT_DIR = `${MONOLITH_DIR}/import`

export function statePath(stage: string): string {
  return `${STATE_DIR}/${stage}.json`
}

export function importSnapshotPath(hash: string): string {
  return `${IMPORT_DIR}/${hash}.json`
}
