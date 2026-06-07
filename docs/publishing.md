# Publishing checklist

Use this before the first public npm release and GitHub launch.

**Public repo:** https://github.com/armancharan/monolith

## Pre-publish

- [x] `pnpm build && pnpm typecheck && pnpm test && pnpm test:integration` all pass
- [x] CHANGELOG updated for release version
- [x] README feature list matches shipped commands
- [x] `docs/commands.md` and `docs/architecture.md` current
- [ ] Dogfood repo (`monolith-m1-dogfood`) validates import → plan → deploy → test

## npm packages

Publish order (dependencies first):

1. `@monolith/core` (if made public — today workspace-private)
2. `@monolith/cloudflare` (if made public)
3. `@monolith/cli` — `monolith` bin
4. `create-monolith` — `npm create monolith`
5. `@monolith/hono`
6. `@monolith/effect`

```bash
# From repo root after version bump
cd packages/cli && npm publish --access public
# or workspace-wide:
pnpm -r publish --access public --no-git-checks
```

Requires npm login with publish rights to `@monolith` scope (or chosen scope).

**Status (2026-06-07):** `npm whoami` not authenticated on this machine — publish documented only. Dry-run for `@monolith/cli@0.2.0` succeeded (tarball ~45 kB, public access).

## GitHub public repo

```bash
gh repo view armancharan/monolith   # https://github.com/armancharan/monolith
git remote -v                       # origin → https://github.com/armancharan/monolith.git
```

Created 2026-06-07 as public repo `armancharan/monolith`; `main` pushed with full history.

## Post-publish

- [ ] Tag release: `git tag v0.2.0 && git push origin v0.2.0`
- [ ] Create GitHub release from tag with CHANGELOG excerpt
- [ ] Verify `npm create monolith` works against published `create-monolith`
- [ ] Copy `templates/github-actions/monolith.yml` into dogfood repo

## Secrets for consumers

| Secret / var | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | plan (--cloud), deploy, CI preview |
| `MONOLITH_STAGE` | production stage name in CI (default `production`) |
| `MONOLITH_STATE_BACKEND=r2` | optional remote state |
| `MONOLITH_STATE_R2_BUCKET` | R2 bucket for state objects |
| `MONOLITH_STATE_R2_ACCESS_KEY_ID` | R2 S3-compatible credentials |
| `MONOLITH_STATE_R2_SECRET_ACCESS_KEY` | R2 S3-compatible credentials |
