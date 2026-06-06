export const MONOLITH_DIR = ".monolith"

export const STATE_DIR = `${MONOLITH_DIR}/state`

export function statePath(stage: string): string {
  return `${STATE_DIR}/${stage}.json`
}
