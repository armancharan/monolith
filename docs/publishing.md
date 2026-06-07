# Publishing checklist

Use this before the first public npm release and GitHub launch.

**Public repo:** https://github.com/armancharan/monolith

## Pre-publish

- [x] `pnpm build && pnpm typecheck && pnpm test && pnpm test:integration` all pass
- [x] CHANGELOG updated for release version (v0.3.0)
- [x] README feature list matches shipped commands
- [x] `docs/commands.md` and `docs/architecture.md` current
- [x] Dogfood repo (`monolith-m1-dogfood`) validates import → plan → deploy with v0.3.0 Effect-native `monolith.run.ts`

## npm packages

Publish order (dependencies first). `@monolith/core` and `@monolith/cloudflare` are workspace-private today — **must** be published (or bundled) before `@monolith/cli` works from npm.

| Package | Version | Publish? | Notes |
| --- | --- | --- | --- |
| `@monolith/core` | 0.3.0 | Required for CLI | Remove `"private": true` in `packages/core/package.json` first |
| `@monolith/cloudflare` | 0.3.0 | Required for CLI | Remove `"private": true` in `packages/cloudflare/package.json` first |
| `@monolith/effect` | 0.3.0 | Yes | `MonolithLive` layer |
| `@monolith/cli` | 0.3.0 | Yes | `monolith` bin |
| `@monolith/hono` | 0.2.0 | Yes | Bump to 0.3.0 before publish |
| `create-monolith` | 0.0.0 | Optional | Remove `"private": true`, bump version, add `publishConfig` |

### Publish commands (run when authed)

```bash
# 1. Login (once per machine)
npm login
npm whoami   # expect your npm username

# 2. From repo root — build first
pnpm build && pnpm typecheck && pnpm test && pnpm test:integration

# 3. Publish in dependency order (after removing private flags on core/cloudflare)
cd packages/core && npm publish --access public
cd ../cloudflare && npm publish --access public
cd ../effect && npm publish --access public
cd ../hono && npm publish --access public   # bump version to 0.3.0 first
cd ../cli && npm publish --access public

# create-monolith (optional scaffold)
cd ../create-monolith && npm publish --access public

# Or workspace-wide (after all packages configured):
pnpm -r publish --access public --no-git-checks
```

Requires npm login with publish rights to `@monolith` scope (create org at npmjs.com if needed).

### Status (2026-06-07)

**Blocked:** `npm whoami` → `ENEEDAUTH` (not logged in on this machine).

Dry-run previously succeeded for `@monolith/cli@0.2.0` (~45 kB tarball, public access). v0.3.0 packages ready; publish pending auth + `@monolith` org scope.

**After publish, verify:**

```bash
npx @monolith/cli@0.3.0 --help
npm create monolith@latest   # when create-monolith published
```

## GitHub public repo

```bash
gh repo view armancharan/monolith   # https://github.com/armancharan/monolith
git remote -v                       # origin → https://github.com/armancharan/monolith.git
```

Created 2026-06-07 as public repo `armancharan/monolith`; `main` pushed with full history.

## Post-publish

- [x] Tag release: `v0.3.0` pushed
- [x] GitHub release v0.3.0 with CHANGELOG excerpt
- [ ] Verify `npm create monolith` works against published `create-monolith`
- [x] GitHub Actions template in repo (`templates/github-actions/monolith.yml`)
- [x] Dogfood repo uses v0.3.0 Effect-native stack format

## Secrets for consumers

| Secret / var | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | plan (--cloud), deploy, CI preview |
| `MONOLITH_STAGE` | production stage name in CI (default `production`) |
| `MONOLITH_STATE_BACKEND=r2` | optional remote state |
| `MONOLITH_STATE_R2_BUCKET` | R2 bucket for state objects |
| `MONOLITH_STATE_R2_ACCESS_KEY_ID` | R2 S3-compatible credentials |
| `MONOLITH_STATE_R2_SECRET_ACCESS_KEY` | R2 S3-compatible credentials |

## Website

- Landing page: `website/index.html`
- Branding: `docs/branding.md`
- Deploy: enable `.github/workflows/deploy-website.yml` when domain/Pages ready
