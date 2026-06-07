import { describe, expect, it } from "vitest"
import { mergeVarsIntoWranglerConfig } from "./stage-vars.js"

describe("mergeVarsIntoWranglerConfig", () => {
  it("merges stage vars into wrangler config", () => {
    const merged = mergeVarsIntoWranglerConfig(
      { name: "demo", vars: { ENV: "dev" } },
      { API_HOST: "https://api.example.com" }
    )
    expect(merged.vars).toEqual({
      ENV: "dev",
      API_HOST: "https://api.example.com"
    })
  })
})
