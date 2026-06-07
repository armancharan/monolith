# Commands

All stage-scoped commands accept `--stage <name>` and `--preview` (resolves stage from `MONOLITH_PREVIEW_ID` or `GITHUB_PR_NUMBER`).

## import

```bash
monolith import <wrangler.toml|wrangler.json|wrangler.jsonc> [--stage <name>] [--preview]
```

Reads wrangler config, writes `.monolith/import/<hash>.json`, optionally generates `monolith.run.ts`, and seeds `.monolith/state/<stage>.json`.

## state init

```bash
monolith state init --stage <name> [--from .monolith/import/<hash>.json]
```

Initialize stage state from an import snapshot without re-importing wrangler.

## state pull / push

```bash
monolith state pull --stage <name>
monolith state push --stage <name>
```

Sync local `.monolith/state/<stage>.json` with remote backend when configured:

| Variable | Purpose |
| --- | --- |
| `MONOLITH_STATE_BACKEND` | `r2` to enable remote backend (default: local only) |
| `MONOLITH_STATE_R2_BUCKET` | R2 bucket name |
| `MONOLITH_STATE_R2_ACCESS_KEY_ID` | R2 S3-compatible access key |
| `MONOLITH_STATE_R2_SECRET_ACCESS_KEY` | R2 S3-compatible secret |

`monolith deploy` auto-pushes state to R2 after success when backend is configured.

## plan

```bash
monolith plan [--stage <name>] [--preview] [--cloud] [--no-cloud] [--local-only]
```

Diff desired state (from `monolith.run.ts`, wrangler, or import) vs `.monolith/state/<stage>.json`. Optional cloud drift hints when Cloudflare auth is available.

## deploy

```bash
monolith deploy [--stage <name>] [--preview] [--auto-approve]
```

Runs `npx wrangler deploy`. Blocks when plan has pending changes unless `--auto-approve`. Preview stages use a temp wrangler config with suffixed Worker name. Logs binding summary (shared vs isolated on preview).

## destroy

```bash
monolith destroy [--stage <name>] [--preview] [--auto-approve]
```

Deletes the Worker script via wrangler and clears local stage state. **Does not** delete D1, KV, R2, or other binding resources from Cloudflare.

## test

```bash
monolith test [--stage <name>] [--preview] [--destroy-after]
```

Plan guard → deploy (`--auto-approve`) → route assertions from `.monolith/test/assertions.json` → optional HTTP 2xx smoke fallback → optional teardown.

Assertion file example:

```json
{
  "routes": [
    { "path": "/health", "expectStatus": 200, "expectBodyContains": "ok" }
  ]
}
```

## dev

```bash
monolith dev [--stage <name>] [--preview] [--watch]
```

Runs `npx wrangler dev` using project wrangler config or a temp config from state/import. Logs stage, config path, and binding summary. Pass `--watch` to enable wrangler watch mode.

## typegen

```bash
monolith typegen --stage <name>
```

Emit `monolith.env.d.ts` binding types from stage state.

## whoami

```bash
monolith whoami [--account-id]
```

Resolve Cloudflare account from `CLOUDFLARE_API_TOKEN` or wrangler OAuth.

## Per-stage wrangler vars

Optional `.monolith/vars.<stage>.json`:

```json
{ "vars": { "ENVIRONMENT": "staging" } }
```

Merged into wrangler config at deploy and dev time.

## Optional packages

### @monolith/hono

```typescript
import { Hono } from "hono"
import { createHonoWorker } from "@monolith/hono"

const app = new Hono()
app.get("/health", (c) => c.text("ok"))

export default createHonoWorker(app)
```

### @monolith/effect

Effect-native adapter — `MonolithEffect` service with `plan` / `deploy` as Effects, plus `CloudflareClientLive` layer. Does not replace the CLI; use in Effect apps that orchestrate Monolith operations.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | whoami, plan (--cloud), deploy | Cloudflare API auth |
| `MONOLITH_PREVIEW_ID` | `--preview` | Explicit preview stage id (e.g. `pr-123`) |
| `GITHUB_PR_NUMBER` | `--preview` | PR number → stage `pr-<n>` |
| `MONOLITH_TEST_URL` | test | Override HTTP smoke URL |
| `MONOLITH_LIVE_TESTS` | test:live | Enable live-cloud smoke in CI |
| `MONOLITH_STATE_BACKEND` | state pull/push, deploy | `r2` for remote state |
| `MONOLITH_STATE_R2_*` | state pull/push | R2 bucket and credentials |
