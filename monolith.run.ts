import { stack } from "@monolith/cloudflare"

export default stack("example", async (ctx) => {
  ctx.worker("api")
  ctx.d1("DB")
  ctx.r2("ASSETS")
})
