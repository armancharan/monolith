# Monolith — agent onboarding

Independent project home for **Monolith** (M1 codename) / **Perch** (portfolio id): TypeScript IaC for Cloudflare Workers.

**Status:** v0.2.0 — Phase A–C complete (import/plan/deploy, cloud drift, dev/test, preview CI, optional R2 state).

## Read first

1. [README.md](./README.md) — elevator pitch, quick start, feature summary
2. [docs/architecture.md](./docs/architecture.md) — packages, reconcile loop, stage model
3. [docs/commands.md](./docs/commands.md) — CLI reference
4. [docs/product-spec.md](./docs/product-spec.md) — full spec, DAGs, roadmap

## Packages

pnpm workspace monorepo. Build: `pnpm build` (`tsc -b` per package). Typecheck includes `monolith.run.ts` via `tsconfig.run.json`.

| Path | Package | Notes |
| --- | --- | --- |
| `packages/core` | `@monolith/core` | Stack types, plan diff, state I/O, preview helpers, remote state interface |
| `packages/cloudflare` | `@monolith/cloudflare` | Wrangler import/parse, temp config, CF API client, R2 state backend |
| `packages/cli` | `@monolith/cli` | `monolith` bin — all lifecycle commands |
| `packages/create-monolith` | `create-monolith` | Scaffold Hono + D1 + KV template |
| `packages/hono` | `@monolith/hono` | Optional Hono preset — `createHonoWorker(app)` |
| `packages/effect` | `@monolith/effect` | Optional Effect Layer adapter (CLI stays async-first) |
| `monolith.run.ts` | — | Example desired-state stack at repo root |

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
- Typed errors (`Data.TaggedError`), not thrown exceptions, when using Effect.
- Node 24+ (`.nvmrc`).

## Portfolio context

Experiment tier — do not steal >15% calendar from Magpie. Reputation metric = design-partner deploys, not GitHub stars.
