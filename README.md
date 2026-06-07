# Monolith

[![GitHub](https://img.shields.io/badge/GitHub-armancharan%2Fmonolith-181717?logo=github)](https://github.com/armancharan/monolith)

TypeScript infrastructure for Cloudflare teams who have outgrown `wrangler.toml` but do not want Terraform ceremony or Effect lock-in. Define Workers, D1, R2, KV, Queues, and Durable Objects in one typed `monolith.run.ts`, get compile-time binding safety, plan/preview/destroy lifecycle, and local dev that matches production.

**Portfolio id:** Perch (experiment) · **M1 codename:** Monolith  
**Status:** Phase A–C complete (v0.2.0) — import/plan/deploy, cloud drift, dev/test harness, preview CI, optional R2 state  
**Positioning:** B2D / agency devtools — reputation-first validation, not Vercel-adjacent hosting or Canva-style creative tooling.

## Features (Phase A–C)

| Area | Capability |
| --- | --- |
| **Core** | import → plan → deploy → typegen; per-stage local state; `monolith.run.ts` desired state |
| **Reconcile** | Cloud drift detection (`--cloud`); DO two-step migration deploy |
| **Preview** | `pr-*` stages; suffixed Worker names; shared D1/KV/R2 bindings |
| **DX** | `monolith dev` with binding summary + `--watch`; route assertions in `monolith test` |
| **Team** | GitHub Action: PR plan + preview deploy + URL comment; optional R2 remote state |
| **Ecosystem** | `create-monolith`, `@monolith/hono`, `@monolith/effect` (optional) |

## Quick start

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm test:integration   # fixture CLI flows, no network
pnpm monolith --help
```

Requires **Node 24+** (see `.nvmrc`).

| Package | Role |
| --- | --- |
| `@monolith/core` | Stack types, plan diff, `.monolith/state/<stage>.json`, remote state interface |
| `@monolith/cloudflare` | CF `stack()` helper, wrangler import, auth client, R2 state backend |
| `@monolith/cli` | `monolith` bin — import, plan, deploy, destroy, test, dev, typegen, state pull/push |
| `create-monolith` | Scaffold Hono + D1 + KV Worker template |
| `@monolith/hono` | Hono preset — `createHonoWorker(app)` |
| `@monolith/effect` | Effect Layer adapter (optional) |

Example stack: [`monolith.run.ts`](./monolith.run.ts) at repo root.

### Scaffold a new project

```bash
pnpm create-monolith ./my-worker
# or from repo root after build:
node packages/create-monolith/bin/create-monolith.js ./my-worker
```

Creates Hono Worker, `wrangler.jsonc` (D1 + KV placeholders), assertions example, and README. Replace resource IDs, then run the Monolith workflow below.

### Typical flow

```bash
monolith import wrangler.jsonc --stage dev
monolith plan --stage dev          # desired: monolith.run.ts + wrangler IDs when run file exists
monolith deploy --stage dev        # blocks if plan has changes
monolith deploy --stage dev --auto-approve
monolith dev --stage dev --watch
monolith test --stage dev          # deploy + route assertions
monolith destroy --stage dev --auto-approve
```

Plan prefers **`monolith.run.ts` binding declarations** merged with wrangler/import resource IDs when the run file is present; otherwise wrangler re-parse or import snapshot.

### Preview stages (PR environments)

Preview stages isolate state and Worker names per pull request:

```bash
monolith import wrangler.jsonc --stage pr-123   # or --preview with GITHUB_PR_NUMBER
monolith plan --preview                           # MONOLITH_PREVIEW_ID or GITHUB_PR_NUMBER
monolith deploy --stage pr-123 --auto-approve
monolith deploy --preview --auto-approve          # same with env-based stage
monolith destroy --preview --auto-approve
```

| Stage | State file | Worker name (deploy) |
| --- | --- | --- |
| `dev` | `.monolith/state/dev.json` | `my-worker` (from wrangler) |
| `pr-123` | `.monolith/state/pr-123.json` | `my-worker-pr-123` (temp config) |

Preview deploy writes `.monolith/wrangler.<stage>.jsonc` with a suffixed script name. D1/KV/R2 bindings remain **shared** with the base stage.

CI: copy [`templates/github-actions/monolith.yml`](./templates/github-actions/monolith.yml) — plan + preview deploy on PR (with URL comment), production deploy on push to `main`. Requires `CLOUDFLARE_API_TOKEN`; optional `MONOLITH_STAGE` secret (default `production`).

### Remote state (optional)

```bash
export MONOLITH_STATE_BACKEND=r2
export MONOLITH_STATE_R2_BUCKET=my-monolith-state
export MONOLITH_STATE_R2_ACCESS_KEY_ID=...
export MONOLITH_STATE_R2_SECRET_ACCESS_KEY=...

monolith state pull --stage dev
monolith deploy --stage dev --auto-approve   # auto-pushes state to R2
monolith state push --stage dev
```

### Destroy (partial teardown)

```bash
monolith destroy --stage dev              # shows plan; requires --auto-approve to proceed
monolith destroy --stage dev --auto-approve
```

- Runs plan first, then `npx wrangler delete <worker-name>` when approved
- Clears `.monolith/state/<stage>.json` on success
- **Safety:** D1 databases, KV namespaces, and R2 buckets are **not** deleted from your Cloudflare account — only the Worker script and local binding state are removed

### Test harness

```bash
monolith test --stage dev
monolith test --stage dev --destroy-after   # deploy, assertions, then destroy
```

Flow: plan guard → deploy (`--auto-approve`) → `.monolith/test/assertions.json` route checks → optional HTTP 2xx fallback → optional teardown.

```json
{ "routes": [{ "path": "/health", "expectStatus": 200, "expectBodyContains": "ok" }] }
```

## Test pyramid

| Layer | Command | What it covers |
| --- | --- | --- |
| Unit / component | `pnpm test` | Plan engine, wrangler parse, auth, assertions, R2 state, hono/effect |
| Fixture integration | `pnpm test:integration` | import → plan → deploy on dogfood wrangler fixture |
| Live-cloud smoke | `pnpm test:live` | Real CF account behind `MONOLITH_LIVE_TESTS=1` |

See [docs/testing.md](./docs/testing.md) and [docs/audit-2026-06-07.md](./docs/audit-2026-06-07.md).

## Milestone 1

**M1-GITHUB-DOGFOOD** — import → plan → deploy → typed bindings on one small GitHub-hosted Worker app (design partner #1 = self).

Full product spec, DAGs, and Phase 0–2 roadmap: [docs/product-spec.md](./docs/product-spec.md).

## Docs

| Doc | Purpose |
| --- | --- |
| [docs/getting-started.md](./docs/getting-started.md) | Install, first deploy, preview stages |
| [docs/commands.md](./docs/commands.md) | CLI command reference |
| [docs/architecture.md](./docs/architecture.md) | Packages, reconcile loop diagram |
| [docs/publishing.md](./docs/publishing.md) | npm publish + public repo checklist |
| [docs/product-spec.md](./docs/product-spec.md) | Canonical product spec (DVI, competitive, GTM, M1 DAGs) |
| [docs/milestone-1.md](./docs/milestone-1.md) | M1 working doc — verification checklist + friction log |
| [docs/testing.md](./docs/testing.md) | Test pyramid and live-test gating |
| [docs/audit-2026-06-07.md](./docs/audit-2026-06-07.md) | Strategic/technical audit summary + test pyramid |
| [CHANGELOG.md](./CHANGELOG.md) | Release notes |

## Portfolio

Tracked in consignment as **Perch** (CF-wedge IaC experiment):

- YAML: `~/work/consignment/data/portfolio/projects/perch.yaml`
- Planning stub (redirect): `~/work/planning/opportunity-intel/portfolio/perch-cf-iac-wedge-2026-06-07.md`

## Rules of engagement

- Public npm org launch per [docs/publishing.md](./docs/publishing.md) when ready.
- Cap calendar at ≤15% vs Magpie until commercial signal.
- Week-12 kill: <50 stars **and** <10 design-partner deploys.
