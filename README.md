# Monolith

TypeScript infrastructure for Cloudflare teams who have outgrown `wrangler.toml` but do not want Terraform ceremony or Effect lock-in. Define Workers, D1, R2, KV, Queues, and Durable Objects in one typed `monolith.run.ts`, get compile-time binding safety, plan/preview/destroy lifecycle, and local dev that matches production.

**Portfolio id:** Perch (experiment) · **M1 codename:** Monolith  
**Status:** experiment / watch — not portfolio slot one vs Magpie  
**Positioning:** B2D / agency devtools — reputation-first validation, not Vercel-adjacent hosting or Canva-style creative tooling.

## Milestone 1 (current)

**M1-GITLAB-DOGFOOD** — import → plan → deploy → typed bindings on one small GitLab-hosted Worker app (design partner #1 = self).

| Goal | Detail |
| --- | --- |
| Target | Existing `wrangler.toml` or `wrangler.jsonc`; ≥2 bindings; ≥2 stages |
| Commands | `monolith import`, `monolith plan --stage dev`, `monolith deploy --stage dev` |
| Done when | AC-1..7 pass + friction log filled — see [docs/milestone-1.md](./docs/milestone-1.md) |

Full product spec, DAGs, and Phase 0–2 roadmap: [docs/product-spec.md](./docs/product-spec.md).

## Docs

| Doc | Purpose |
| --- | --- |
| [docs/product-spec.md](./docs/product-spec.md) | Canonical product spec (DVI, competitive, GTM, M1 DAGs) |
| [docs/milestone-1.md](./docs/milestone-1.md) | M1 working doc — verification checklist + friction log |

## Portfolio

Tracked in consignment as **Perch** (CF-wedge IaC experiment):

- YAML: `~/work/consignment/data/portfolio/projects/perch.yaml`
- Planning stub (redirect): `~/work/planning/opportunity-intel/portfolio/perch-cf-iac-wedge-2026-06-07.md`

## Rules of engagement

- No public npm org or GitHub launch until M1 postconditions met.
- Cap calendar at ≤15% vs Magpie until commercial signal.
- Week-12 kill: <50 stars **and** <10 design-partner deploys.
