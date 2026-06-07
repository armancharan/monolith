import { describe, expect, it } from "vitest"
import { directoryIsEmpty } from "./create.js"

describe("directoryIsEmpty", () => {
  it("returns true for paths that do not exist yet", async () => {
    await expect(directoryIsEmpty("/tmp/monolith-nonexistent-dir-test")).resolves.toBe(true)
  })
})
