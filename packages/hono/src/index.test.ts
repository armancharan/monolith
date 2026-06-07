import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { createHonoWorker } from "./index.js"

describe("createHonoWorker", () => {
  it("exports fetch handler bound to the Hono app", async () => {
    const app = new Hono()
    app.get("/health", (c) => c.text("ok"))

    const worker = createHonoWorker(app)
    const response = await worker.fetch(new Request("http://localhost/health"))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("ok")
  })
})
