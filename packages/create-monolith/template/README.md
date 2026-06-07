# my-monolith-worker

Minimal [Monolith](https://github.com/armancharan/monolith) scaffold: Hono Worker with D1 + KV bindings.

## Setup

```bash
npm install

# Create Cloudflare resources and paste IDs into wrangler.jsonc:
# wrangler d1 create my-monolith-db
# wrangler kv namespace create MY_KV

npm run dev
```

## Monolith workflow

```bash
# 1. Import wrangler config into Monolith state
monolith import wrangler.jsonc --stage dev

# 2. Review planned changes
monolith plan --stage dev

# 3. Deploy to Cloudflare
monolith deploy --stage dev --auto-approve

# 4. Run post-deploy assertions (see .monolith/test/assertions.json)
monolith test --stage dev

# 5. Local dev with stage bindings
monolith dev --stage dev
monolith dev --stage dev --watch

# 6. Tear down Worker (bindings remain in CF account)
monolith destroy --stage dev --auto-approve
```

## Preview stages (CI / PR)

```bash
export GITHUB_PR_NUMBER=42
monolith import wrangler.jsonc --preview
monolith plan --preview
monolith deploy --preview --auto-approve
monolith destroy --preview --auto-approve
```

Copy `templates/github-actions/monolith.yml` from the Monolith repo for automated plan + preview deploy on pull requests.

## Per-stage wrangler vars

Optional file `.monolith/vars.<stage>.json`:

```json
{ "vars": { "ENVIRONMENT": "staging" } }
```

Merged into wrangler config at deploy/dev time. Preview stages share D1/KV/R2 bindings; only the Worker name is isolated.

## Routes

| Path | Response |
| --- | --- |
| `/` | `ok` |
| `/health` | `ok` |

## Assertions

`.monolith/test/assertions.json` runs after `monolith test` deploys:

```json
{
  "routes": [
    { "path": "/health", "expectStatus": 200, "expectBodyContains": "ok" }
  ]
}
```

## Safety note

`monolith destroy` removes the Worker script and clears local stage state. **D1 databases, KV namespaces, and R2 buckets are not deleted** from your Cloudflare account — only binding references are torn down with the Worker.

## Optional packages

- `@monolith/hono` — `createHonoWorker(app)` export helper
- `@monolith/effect` — Effect Layer adapter for plan/deploy in Effect-native apps
