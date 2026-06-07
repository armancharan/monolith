import { afterEach, describe, expect, it, vi } from "vitest"
import { parseStageArgs, resolvePreviewIdFromEnv } from "./stage.js"

describe("resolvePreviewIdFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("prefers MONOLITH_PREVIEW_ID", () => {
    vi.stubEnv("MONOLITH_PREVIEW_ID", "pr-99")
    vi.stubEnv("GITHUB_PR_NUMBER", "1")
    expect(resolvePreviewIdFromEnv()).toBe("pr-99")
  })

  it("falls back to GITHUB_PR_NUMBER", () => {
    vi.stubEnv("GITHUB_PR_NUMBER", "42")
    expect(resolvePreviewIdFromEnv()).toBe("pr-42")
  })

  it("returns undefined when env is unset", () => {
    expect(resolvePreviewIdFromEnv({})).toBeUndefined()
  })
})

describe("parseStageArgs", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses explicit --stage over --preview", () => {
    vi.stubEnv("GITHUB_PR_NUMBER", "1")
    const parsed = parseStageArgs(["--preview", "--stage", "pr-123"])
    expect(parsed.stage).toBe("pr-123")
    expect(parsed.preview).toBe(true)
  })

  it("resolves stage from env when --preview is set", () => {
    vi.stubEnv("GITHUB_PR_NUMBER", "7")
    const parsed = parseStageArgs(["--preview"])
    expect(parsed.stage).toBe("pr-7")
  })

  it("applies default stage when neither flag is set", () => {
    const parsed = parseStageArgs([], { defaultStage: "dev" })
    expect(parsed.stage).toBe("dev")
  })
})
