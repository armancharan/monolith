# Monolith — agent onboarding

Independent project home for **Monolith** (M1 codename) / **Perch** (portfolio id): TypeScript IaC for Cloudflare Workers.

## Read first

1. [README.md](./README.md) — elevator pitch and M1 goal
2. [docs/milestone-1.md](./docs/milestone-1.md) — active M1 contract, checklist, friction log
3. [docs/product-spec.md](./docs/product-spec.md) — full spec, DAGs, kill rules

## M1 scope

Build local CLI only (`monolith import|plan|deploy`). Async-first; Effect optional later. Deploy via Wrangler subprocess for M1. Local JSON state at `.monolith/state/<stage>.json` (gitignored).

**Non-goals for M1:** npm publish, preview SaaS, GitLab CI wiring, `destroy`, remote state, AWS/multi-cloud.

## Conventions

- 2-space indent, double-quoted strings, no semicolons (match Magpie repo style when adding TS).
- Tests colocate: `Foo.ts` + `Foo.test.ts`.
- Typed errors (`Data.TaggedError`), not thrown exceptions, when using Effect.
- Node 24+ if Effect/platform deps appear later.

## Portfolio context

Experiment tier — do not steal >15% calendar from Magpie. Reputation metric = design-partner deploys, not GitHub stars.
