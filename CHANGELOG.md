# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-07

### Added

- **Phase B — Developer experience**
  - `monolith dev` hardening: stage binding summary, `--watch` passthrough, preview/temp config from state/import
  - `monolith test` evaluates `.monolith/test/assertions.json` route assertions after deploy
  - `@monolith/hono` — `createHonoWorker(app)` preset for Hono Workers
  - `@monolith/effect` — optional Effect Layer adapter (`MonolithEffect`, `CloudflareClientLive`)
  - `create-monolith` template: assertions example, full workflow README

- **Phase C — Team / inheritance**
  - GitHub Actions template: PR preview deploy + PR comment with worker URL
  - Remote state backend (R2): `MONOLITH_STATE_BACKEND=r2`, `monolith state pull|push`
  - Per-stage wrangler vars: `.monolith/vars.<stage>.json` merged at deploy/dev
  - Preview stages log shared vs isolated bindings (worker isolated, storage shared)

- **Phase D prep**
  - `docs/publishing.md` npm + GitHub checklist
  - CI live-smoke gated on `vars.MONOLITH_LIVE_TESTS == '1'`

- **Phase D — Publication + deferred work**
  - Public GitHub repo: https://github.com/armancharan/monolith
  - `monolith deploy --ensure-resources` — auto-creates D1/KV when wrangler has `REPLACE_*` placeholder IDs via wrangler CLI
  - `@monolith/effect` `deploy` wired to shared `executeDeploy` from `@monolith/cli/deploy`
  - Integration test for route assertions in test harness
  - `@monolith/cli` publish prep: `files`, `./deploy` export, test artifacts excluded from dist

### Changed

- `monolith deploy` auto-pushes state to R2 when remote backend configured
- Root and CLI version `0.2.0`; architecture and audit docs updated

## [0.1.0] - 2026-06-07

### Added

- Preview stages: `--stage pr-<n>` or `--preview` with `MONOLITH_PREVIEW_ID` / `GITHUB_PR_NUMBER`
- Per-stage state at `.monolith/state/<stage>.json`; preview deploy suffixes Worker name (`my-worker-pr-123`)
- GitHub Actions template at `templates/github-actions/monolith.yml` (plan on PR, deploy on main)
- Documentation: getting started, commands reference, architecture / reconcile loop
- `monolith destroy`, `monolith test`, and `create-monolith` scaffold (from prior release work in this milestone)

### Changed

- Root and `@monolith/cli` version set to `0.1.0`; CLI prepared for public npm (`publishConfig.access: public`)

[0.2.0]: https://github.com/armancharan/monolith/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/armancharan/monolith/compare/v0.0.0...v0.1.0
