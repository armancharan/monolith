# Monolith — agent onboarding

Independent project home for **Monolith** (M1 codename) / **Perch** (portfolio id): **Effect-native** TypeScript IaC for Cloudflare Workers.

**Status:** v0.3.0 — Effect-native core; Phase A–C complete (import/plan/deploy, cloud drift, dev/test, preview CI, optional R2 state).

## Read first

1. [README.md](./README.md) — elevator pitch, quick start, feature summary
2. [docs/architecture.md](./docs/architecture.md) — packages, reconcile loop, stage model
3. [docs/commands.md](./docs/commands.md) — CLI reference
4. [docs/product-spec.md](./docs/product-spec.md) — full spec, DAGs, roadmap

## Effect idioms

Monolith follows Magpie conventions:

1. **Services use `Context.Service`, not `Effect.Service`.**
2. **Typed errors via `Data.TaggedError`** — no throw, no dual `Result` + `Effect`.
3. **Layers:** `Layer.effect` for live implementations; `MonolithLive` composes core + Cloudflare.
4. **CLI boundary ONLY:** `Effect.runPromise(program.pipe(Effect.provide(makeMonolithLive())))` in `main.ts`.

## Packages

pnpm workspace monorepo. Build: `pnpm build` (`tsc -b` per package). Typecheck includes `monolith.run.ts` via `tsconfig.run.json`.

| Path | Package | Notes |
| --- | --- | --- |
| `packages/core` | `@monolith/core` | `StateStore`, `PlanEngine`, `ReconcileProgram` Effect services |
| `packages/cloudflare` | `@monolith/cloudflare` | `stack()` returns Effect program; `CloudflareClient`, `WranglerDeployer` Layers |
| `packages/cli` | `@monolith/cli` | argv → Effect programs → `runPromise` |
| `packages/create-monolith` | `create-monolith` | Scaffold Hono + D1 + KV template |
| `packages/hono` | `@monolith/hono` | Optional Hono preset — `createHonoWorker(app)` |
| `packages/effect` | `@monolith/effect` | `MonolithLive`, service/tag re-exports |
| `monolith.run.ts` | — | Example desired-state stack at repo root |

## Stack authoring

```typescript
import { Effect } from "effect"
import { stack } from "@monolith/cloudflare"

export default stack("my-app", (ctx) =>
  Effect.gen(function* () {
    yield* ctx.worker("api")
    yield* ctx.d1("DB", { databaseId: "..." })
  })
)
```

## CLI commands

Stage-scoped via `--stage <name>` or `--preview` (`MONOLITH_PREVIEW_ID` / `GITHUB_PR_NUMBER`).

| Command | Purpose |
| --- | --- |
| `import` | Parse wrangler config → import snapshot + seed state |
| `plan` | Three-way diff: desired vs local state vs cloud (drift) |
| `deploy` | Wrangler subprocess apply; blocks on pending plan unless `--auto-approve` |
| `destroy` | Delete Worker script, clear local state (D1/KV/R2 untouched) |
| `dev` | `wrangler dev` with binding summary; `--watch` |
| `test` | Plan → deploy → route assertions → optional teardown |
| `typegen` | Emit `monolith.env.d.ts` from stage state |
| `state pull` / `state push` | Sync local state with optional R2 backend |

`deploy --ensure-resources` (or auto when wrangler has `REPLACE_*` IDs) creates D1/KV via wrangler before deploy.

## Reconcile model

Desired → plan → apply → state. Wrangler is the deploy engine.

- **Plan:** compares desired (`monolith.run.ts` + wrangler IDs) against local `.monolith/state/<stage>.json` and cloud actual (Workers Settings API). Shows drift vs cloud and pending vs last state. `--local-only` skips cloud.
- **Deploy:** `npx wrangler deploy`; updates state with `deployedAt` / `workerUrl`. DO migrations may require two-step deploy.
- **Preview stages:** `pr-*` → suffixed Worker name via temp `.monolith/wrangler.<stage>.jsonc`; D1/KV/R2 bindings shared.
- **Remote state:** opt-in R2 via `MONOLITH_STATE_BACKEND=r2`; deploy auto-pushes on success.

## Test pyramid

| Layer | Command | Scope |
| --- | --- | --- |
| Unit / component | `pnpm test` | Plan engine, wrangler parse, auth, assertions, R2, hono/effect |
| Fixture integration | `pnpm test:integration` | import → plan → deploy on dogfood fixture (no network) |
| Live-cloud smoke | `pnpm test:live` | Real CF account; gated by `MONOLITH_LIVE_TESTS=1` |

See [docs/testing.md](./docs/testing.md).

## Conventions

- 2-space indent, double quotes, no semicolons (match Magpie repo style when adding TS).
- Tests colocate: `Foo.ts` + `Foo.test.ts`.
- Typed errors (`Data.TaggedError`), not thrown exceptions.
- Node 24+ (`.nvmrc`).
- Effect version: `4.0.0-beta.54` (aligned with Magpie).

## Portfolio context

Experiment tier — do not steal >15% calendar from Magpie. Reputation metric = design-partner deploys, not GitHub stars.
