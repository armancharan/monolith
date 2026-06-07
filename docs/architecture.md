# Architecture

Monolith is a TypeScript IaC layer for Cloudflare Workers. Wrangler remains the deploy engine; Monolith adds desired-state planning, per-stage local (or optional remote) state, and typed bindings.

## Packages

| Package | Role |
| --- | --- |
| `@monolith/core` | Stack types, plan diff, state I/O, preview stage helpers, remote state interface |
| `@monolith/cloudflare` | Wrangler import/parse, temp config, Cloudflare API client, R2 state backend |
| `@monolith/cli` | `monolith` bin — import, plan, deploy, destroy, test, dev, typegen, state pull/push |
| `create-monolith` | Project scaffold (Hono + D1 + KV template) |
| `@monolith/hono` | Optional Hono preset — `createHonoWorker(app)` |
| `@monolith/effect` | Optional Effect Layer adapter for Effect-native apps |

## Reconcile loop

Monolith follows a Terraform-style loop: **desired → plan → apply → state**.

```mermaid
flowchart LR
  subgraph inputs [Desired state]
    RUN[monolith.run.ts]
    WR[wrangler.jsonc]
    IMP[.monolith/import snapshot]
    VARS[.monolith/vars.stage.json]
  end

  subgraph reconcile [Reconcile]
    PLAN[monolith plan]
    DIFF[plan diff engine]
    DEPLOY[monolith deploy]
    WRANGLER[wrangler deploy]
  end

  subgraph persist [State]
    LOCAL[".monolith/state/stage.json"]
    REMOTE[R2 optional]
  end

  RUN --> PLAN
  WR --> PLAN
  IMP --> PLAN
  LOCAL --> PLAN
  PLAN --> DIFF
  DIFF -->|no changes| DONE[exit 0]
  DIFF -->|changes| DEPLOY
  VARS --> DEPLOY
  DEPLOY --> WRANGLER
  WRANGLER --> LOCAL
  LOCAL --> REMOTE
```

### Desired state resolution (plan)

1. If `monolith.run.ts` exists → parse binding declarations, merge resource IDs from wrangler/import.
2. Else if wrangler config exists → parse wrangler into resources.
3. Else → fall back to latest import snapshot.

### Plan diff

`@monolith/core` compares resources and emits create/update/delete changes.

**Phase A (reconcile):** when Cloudflare credentials are available (or `--cloud` is passed), `monolith plan` reads **cloud actual** via the Workers Settings API and shows two sections:

| Section | Compares | Meaning |
| --- | --- | --- |
| Changes vs cloud (drift) | cloud actual → desired | Dashboard edits or external deploys not reflected in wrangler |
| Changes vs last state | local state → desired | Pending apply since last `monolith deploy` |

Use `--local-only` to revert to state-vs-desired only (pre-Phase A behavior).

### Apply (deploy)

`monolith deploy` invokes wrangler as a subprocess. On success, state is updated with `deployedAt` and `workerUrl` parsed from wrangler output. Optional R2 push when `MONOLITH_STATE_BACKEND=r2`.

Deploy blocks when **either** local pending changes **or** cloud drift exist, unless `--auto-approve`.

**Durable Object migrations:** when wrangler declares `new_classes` / `new_sqlite_classes` migration tags alongside DO bindings, deploy runs wrangler **twice** (Cloudflare two-step migration requirement).

Preview stages (`pr-*`) write `.monolith/wrangler.<stage>.jsonc` with Worker name suffix before deploy. Binding summary logs worker as **isolated**, D1/KV/R2 as **shared**.

### Test harness

`monolith test` runs plan → deploy → `.monolith/test/assertions.json` route checks → optional HTTP smoke → optional `--destroy-after`.

### Destroy

Partial teardown: deletes Worker script, clears local state. Shared binding resources (D1/KV/R2) remain in the Cloudflare account by design.

## Stage model

Each stage is an isolated namespace:

- State: `.monolith/state/<stage>.json` (local default)
- Remote: `monolith/state/<stage>.json` in R2 when configured
- Preview stages: `pr-<number>` with suffixed Worker name `<base>-pr-<number>`
- Per-stage vars: `.monolith/vars.<stage>.json` merged at deploy/dev

Production and dev stages use the wrangler config name as-is.

## M1+ boundaries

- Local JSON state default; R2 remote opt-in
- Wrangler subprocess for deploy (no direct Workers API deploy)
- No preview SaaS — preview stages are CLI + CI convention
- `@monolith/effect` adapter stub — CLI remains async-first

See [product-spec.md](./product-spec.md) for Phase 0–2 roadmap.
