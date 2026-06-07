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
monolith import wrangler.jsonc --stage dev
monolith plan --stage dev
monolith deploy --stage dev
monolith test --stage dev          # deploy + HTTP smoke
monolith destroy --stage dev --auto-approve
```

## Safety note

`monolith destroy` removes the Worker script and clears local stage state. **D1 databases, KV namespaces, and R2 buckets are not deleted** from your Cloudflare account — only binding references are torn down with the Worker.

## Routes

| Path | Response |
| --- | --- |
| `/` | `ok` |
| `/health` | `ok` (used by `monolith test` HTTP smoke when deployed) |

## Assertions (future)

Add `.monolith/test/assertions.json` for structured post-deploy checks. See Monolith docs for the assertion file schema.
