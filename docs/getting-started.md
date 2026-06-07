# Getting started

Monolith turns an existing Wrangler project into a typed, plan-driven deploy workflow.

## Prerequisites

- Node.js 24+
- A Cloudflare account with Workers enabled
- An existing `wrangler.jsonc` (or `.toml` / `.json`) with at least one Worker

## Install

From npm (when published):

```bash
npm install -D @monolith/cli
```

From this monorepo during development:

```bash
pnpm install
pnpm build
pnpm monolith --help
```

Or scaffold a new project:

```bash
pnpm create-monolith ./my-worker
```

## First deploy

```bash
cd my-worker
export CLOUDFLARE_API_TOKEN=...   # or run wrangler login locally

monolith import wrangler.jsonc --stage dev
monolith plan --stage dev
monolith deploy --stage dev --auto-approve
```

State is written to `.monolith/state/dev.json` (gitignored). Re-run `plan` before deploy to see diffs between desired config and last apply.

## Preview stages (PR environments)

Preview stages namespace state and Worker names per pull request:

| Input | Resolved stage | State file |
| --- | --- | --- |
| `--stage pr-123` | `pr-123` | `.monolith/state/pr-123.json` |
| `--preview` + `GITHUB_PR_NUMBER=123` | `pr-123` | `.monolith/state/pr-123.json` |
| `--preview` + `MONOLITH_PREVIEW_ID=pr-456` | `pr-456` | `.monolith/state/pr-456.json` |

```bash
# Seed preview state (CI or locally)
monolith import wrangler.jsonc --stage pr-123
# or in GitHub Actions: monolith import wrangler.jsonc --preview

monolith plan --preview
monolith deploy --preview --auto-approve
monolith destroy --preview --auto-approve   # tear down preview Worker
```

Preview deploy writes a temp config at `.monolith/wrangler.<stage>.jsonc` with a suffixed Worker name (`my-worker-pr-123`). The preview URL is the standard `*.workers.dev` subdomain for that script. For custom domains, add route prefixes in wrangler separately.

## CI

Copy [`templates/github-actions/monolith.yml`](../templates/github-actions/monolith.yml) into your repo. See [commands.md](./commands.md) for flag reference.

## Next steps

- [Commands reference](./commands.md)
- [Architecture & reconcile loop](./architecture.md)
- [M1 milestone checklist](./milestone-1.md)
