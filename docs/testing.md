# Testing

Monolith uses a three-layer test pyramid: unit, integration, and live-cloud smoke.

## Layers

| Layer | Location | Network | Proves |
| --- | --- | --- | --- |
| **Unit** | `packages/*/src/*.test.ts` | No | Plan engine, state, wrangler parse, auth, typegen, CLI components |
| **Integration** | `packages/cli/tests/integration/` | No | import → plan → deploy flow with fixture wrangler + mocked wrangler subprocess |
| **Live smoke** | `packages/cli/tests/live/` | Yes (Cloudflare) | Real token auth (`whoami`); optional deployed worker `/health` |

## Commands

From repo root:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test                 # unit tests (core, cloudflare, cli)
pnpm test:integration     # fixture CLI flows
pnpm test:live            # live-cloud smoke (gated)
```

Run a single package:

```bash
pnpm --filter @monolith/core test
pnpm --filter @monolith/cloudflare test
pnpm --filter @monolith/cli test
```

## Live smoke gate

Live tests **never run against Cloudflare by default**. Enable explicitly:

```bash
export MONOLITH_LIVE_TESTS=1
export CLOUDFLARE_API_TOKEN=...   # or use `wrangler login` OAuth locally
# optional: deployed worker base URL for HTTP check
export MONOLITH_LIVE_WORKER_URL=https://your-worker.example.workers.dev
pnpm test:live
```

Without `MONOLITH_LIVE_TESTS=1`, live tests log a skip message and pass.

## CI

GitHub Actions workflow `.github/workflows/test.yml` runs on push/PR:

- `pnpm install`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`

A **scheduled live-smoke job** is stubbed but disabled (`if: false`). To enable:

1. Uncomment the `schedule` block in `test.yml`
2. Add repository secrets: `CLOUDFLARE_API_TOKEN` (required), `MONOLITH_LIVE_WORKER_URL` (optional)
3. Set `live-smoke` job `if: true` (or use a cron-only condition)

## Secrets for live CI

| Secret | Required | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes | API auth for `whoami` and future deploy smoke |
| `MONOLITH_LIVE_WORKER_URL` | No | Base URL for optional `/health` HTTP check |

Use a token scoped to the dogfood account only. Do not commit tokens or `.wrangler` OAuth files.
