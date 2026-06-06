# Monolith — agent onboarding

Independent project home for **Monolith** (M1 codename) / **Perch** (portfolio id): TypeScript IaC for Cloudflare Workers.

## Read first

1. [README.md](./README.md) — elevator pitch and M1 goal
2. [docs/milestone-1.md](./docs/milestone-1.md) — active M1 contract, checklist, friction log
3. [docs/product-spec.md](./docs/product-spec.md) — full spec, DAGs, kill rules

## Architecture (C0)

pnpm workspace monorepo:

| Path | Package | Notes |
| --- | --- | --- |
| `packages/core` | `@monolith/core` | `stack()`, `StackContext`, `.monolith/` state path constants |
| `packages/cloudflare` | `@monolith/cloudflare` | CF `stack()` with Worker/D1/R2/KV stubs; reconcile in C3/C4 |
| `packages/cli` | `@monolith/cli` | `monolith` bin — C0 stubs only |
| `monolith.run.ts` | — | Example async-first stack shell at repo root |

Build: `pnpm build` (`tsc -b` per package). Typecheck includes `monolith.run.ts` via `tsconfig.run.json`.

## M1 scope

Build local CLI only (`monolith import|plan|deploy`). Async-first; Effect optional later. Deploy via Wrangler subprocess for M1. Local JSON state at `.monolith/state/<stage>.json` (gitignored).

**Non-goals for M1:** npm publish, preview SaaS, GitHub Actions wiring (optional stub), `destroy`, remote state, AWS/multi-cloud.

## Conventions

- 2-space indent, double quotes, no semicolons (match Magpie repo style when adding TS).
- Tests colocate: `Foo.ts` + `Foo.test.ts`.
- Typed errors (`Data.TaggedError`), not thrown exceptions, when using Effect.
- Node 24+ (`.nvmrc`).

## Portfolio context

Experiment tier — do not steal >15% calendar from Magpie. Reputation metric = design-partner deploys, not GitHub stars.
