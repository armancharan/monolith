import { Hono } from "hono"

type Bindings = {
  DB: D1Database
  KV: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

app.get("/", (c) => c.text("ok"))

app.get("/health", (c) => c.text("ok"))

export default app
