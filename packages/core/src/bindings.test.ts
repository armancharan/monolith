import { describe, expect, it } from "vitest"
import { formatBindingSummary, summarizeBindings } from "./bindings.js"

describe("summarizeBindings", () => {
  it("marks worker isolated on preview stages", () => {
    const entries = summarizeBindings(
      [
        { id: "worker:demo", kind: "worker", name: "demo" },
        { id: "d1:DB", kind: "d1", binding: "DB", name: "demo-db" }
      ],
      { previewStage: true }
    )

    expect(entries[0]?.shared).toBe(false)
    expect(entries[1]?.shared).toBe(true)
  })
})

describe("formatBindingSummary", () => {
  it("renders binding lines", () => {
    const text = formatBindingSummary(
      summarizeBindings([{ id: "kv:KV", kind: "kv", binding: "KV" }])
    )
    expect(text).toContain("kv:KV")
    expect(text).toContain("shared")
  })
})
