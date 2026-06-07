# Monolith

TypeScript infrastructure for Cloudflare teams who have outgrown `wrangler.toml` but do not want Terraform ceremony or Effect lock-in. Define Workers, D1, R2, KV, Queues, and Durable Objects in one typed `monolith.run.ts`, get compile-time binding safety, plan/preview/destroy lifecycle, and local dev that matches production.

**Portfolio id:** Perch (experiment) · **M1 codename:** Monolith  
**Status:** C1–C8 + destroy, test harness, create-monolith scaffold  
**Positioning:** B2D / agency devtools — reputation-first validation, not Vercel-adjacent hosting or Canva-style creative tooling.

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
| `@monolith/core` | Stack types, plan diff, `.monolith/state/<stage>.json` |
| `@monolith/cloudflare` | CF `stack()` helper, wrangler import, auth client |
| `@monolith/cli` | `monolith` bin — import, plan, deploy, destroy, test, typegen, whoami |
| `create-monolith` | Scaffold Hono + D1 + KV Worker template |

Example stack: [`monolith.run.ts`](./monolith.run.ts) at repo root.

### Scaffold a new project

```bash
pnpm create-monolith ./my-worker
# or from repo root after build:
node packages/create-monolith/bin/create-monolith.js ./my-worker
```

Creates Hono Worker, `wrangler.jsonc` (D1 + KV placeholders), and README. Replace resource IDs, then run the Monolith workflow below. `monolith import` generates `monolith.run.ts`.

### Typical flow

```bash
monolith import wrangler.jsonc --stage dev
monolith plan --stage dev          # desired: monolith.run.ts + wrangler IDs when run file exists
monolith deploy --stage dev        # blocks if plan has changes
monolith deploy --stage dev --auto-approve
monolith test --stage dev          # deploy + optional HTTP smoke
monolith destroy --stage dev --auto-approve
```

Plan prefers **`monolith.run.ts` binding declarations** merged with wrangler/import resource IDs when the run file is present; otherwise wrangler re-parse or import snapshot.

### Destroy (partial teardown)

```bash
monolith destroy --stage dev              # shows plan; requires --auto-approve to proceed
monolith destroy --stage dev --auto-approve
```

- Runs plan first, then `npx wrangler delete <worker-name>` when approved
- Clears `.monolith/state/<stage>.json` on success
- **Safety:** D1 databases, KV namespaces, and R2 buckets are **not** deleted from your Cloudflare account — only the Worker script and local binding state are removed

### Test harness (M1-style)

```bash
monolith test --stage dev
monolith test --stage dev --destroy-after   # deploy, smoke, then destroy
MONOLITH_TEST_URL=https://... monolith test --stage dev
```

Flow: plan guard → deploy (`--auto-approve`) → optional HTTP 2xx check (`MONOLITH_TEST_URL` or `workerUrl` in state) → optional teardown.

Future structured assertions: `.monolith/test/assertions.json` (see create-monolith template example).

## Test pyramid

| Layer | Command | What it covers |
| --- | --- | --- |
| Unit / component | `pnpm test` | Plan engine, wrangler parse, auth, mocked deploy/destroy/test |
| Fixture integration | `pnpm test:integration` | import → plan → deploy on dogfood wrangler fixture |
| Live-cloud smoke | `pnpm test:live` | Real CF account behind `MONOLITH_LIVE_TESTS=1` |

See [docs/testing.md](./docs/testing.md) and [docs/audit-2026-06-07.md](./docs/audit-2026-06-07.md).

## Milestone 1

**M1-GITHUB-DOGFOOD** — import → plan → deploy → typed bindings on one small GitHub-hosted Worker app (design partner #1 = self).

| Goal | Detail |
| --- | --- |
| Target | Existing `wrangler.toml` or `wrangler.jsonc`; ≥2 bindings; ≥2 stages |
| Commands | `monolith import`, `monolith plan --stage dev`, `monolith deploy --stage dev` |
| Done when | AC-1..7 pass + friction log filled — see [docs/milestone-1.md](./docs/milestone-1.md) |

Full product spec, DAGs, and Phase 0–2 roadmap: [docs/product-spec.md](./docs/product-spec.md).

### M1 dogfood repo (GitHub)

Monolith CLI is developed here; the **validation app** is a separate private GitHub repo.

| | |
| --- | --- |
| Repo name | `monolith-m1-dogfood` |
| Local path | `~/work/monolith-dogfood` |

Install and authenticate GitHub CLI, then bootstrap:

```bash
brew install gh   # if `gh` not on PATH
gh auth login
```

See [docs/milestone-1.md](./docs/milestone-1.md#dogfood-repo-github) for `gh repo create`, clone, and Wrangler baseline deploy.

## Docs

| Doc | Purpose |
| --- | --- |
| [docs/product-spec.md](./docs/product-spec.md) | Canonical product spec (DVI, competitive, GTM, M1 DAGs) |
| [docs/milestone-1.md](./docs/milestone-1.md) | M1 working doc — verification checklist + friction log |
| [docs/testing.md](./docs/testing.md) | Test pyramid and live-test gating |
| [docs/audit-2026-06-07.md](./docs/audit-2026-06-07.md) | Strategic/technical audit summary + test pyramid |

## Portfolio

Tracked in consignment as **Perch** (CF-wedge IaC experiment):

- YAML: `~/work/consignment/data/portfolio/projects/perch.yaml`
- Planning stub (redirect): `~/work/planning/opportunity-intel/portfolio/perch-cf-iac-wedge-2026-06-07.md`

## Rules of engagement

- No public npm org or GitHub launch until M1 postconditions met.
- Cap calendar at ≤15% vs Magpie until commercial signal.
- Week-12 kill: <50 stars **and** <10 design-partner deploys.
