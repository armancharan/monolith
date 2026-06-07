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

## plan

```bash
monolith plan [--stage <name>] [--preview] [--cloud] [--no-cloud]
```

Diff desired state (from `monolith.run.ts`, wrangler, or import) vs `.monolith/state/<stage>.json`. Optional cloud drift hints when Cloudflare auth is available.

## deploy

```bash
monolith deploy [--stage <name>] [--preview] [--auto-approve]
```

Runs `npx wrangler deploy`. Blocks when plan has pending changes unless `--auto-approve`. Preview stages use a temp wrangler config with suffixed Worker name.

## destroy

```bash
monolith destroy [--stage <name>] [--preview] [--auto-approve]
```

Deletes the Worker script via wrangler and clears local stage state. **Does not** delete D1, KV, R2, or other binding resources from Cloudflare.

## test

```bash
monolith test [--stage <name>] [--preview] [--destroy-after]
```

Plan guard → deploy (`--auto-approve`) → optional HTTP 2xx smoke (`MONOLITH_TEST_URL` or state `workerUrl`) → optional teardown.

## dev

```bash
monolith dev [--stage <name>] [--preview]
```

Runs `npx wrangler dev` using project wrangler config or a temp config from state/import.

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

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | whoami, plan (--cloud), deploy | Cloudflare API auth |
| `MONOLITH_PREVIEW_ID` | `--preview` | Explicit preview stage id (e.g. `pr-123`) |
| `GITHUB_PR_NUMBER` | `--preview` | PR number → stage `pr-<n>` |
| `MONOLITH_TEST_URL` | test | Override HTTP smoke URL |
| `MONOLITH_LIVE_TESTS` | test:live | Enable live-cloud smoke in CI |
