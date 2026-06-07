import { describe, expect, it } from "vitest"
import { isPreviewStage, normalizePreviewStage, previewWorkerName } from "./stage.js"

describe("stage helpers", () => {
  it("detects pr-* preview stages", () => {
    expect(isPreviewStage("pr-123")).toBe(true)
    expect(isPreviewStage("dev")).toBe(false)
    expect(isPreviewStage("production")).toBe(false)
  })

  it("normalizes preview ids with pr- prefix", () => {
    expect(normalizePreviewStage("123")).toBe("pr-123")
    expect(normalizePreviewStage("pr-456")).toBe("pr-456")
  })

  it("suffixes worker name for preview stages", () => {
    expect(previewWorkerName("my-worker", "pr-123")).toBe("my-worker-pr-123")
    expect(previewWorkerName("my-worker", "dev")).toBe("my-worker")
    expect(previewWorkerName("my-worker-pr-123", "pr-123")).toBe("my-worker-pr-123")
  })
})
