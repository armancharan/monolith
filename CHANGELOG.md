# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-07

### Added

- Preview stages: `--stage pr-<n>` or `--preview` with `MONOLITH_PREVIEW_ID` / `GITHUB_PR_NUMBER`
- Per-stage state at `.monolith/state/<stage>.json`; preview deploy suffixes Worker name (`my-worker-pr-123`)
- GitHub Actions template at `templates/github-actions/monolith.yml` (plan on PR, deploy on main)
- Documentation: getting started, commands reference, architecture / reconcile loop
- `monolith destroy`, `monolith test`, and `create-monolith` scaffold (from prior release work in this milestone)

### Changed

- Root and `@monolith/cli` version set to `0.1.0`; CLI prepared for public npm (`publishConfig.access: public`)

[0.1.0]: https://github.com/armancharan/monolith/compare/v0.0.0...v0.1.0
