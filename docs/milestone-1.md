# Milestone 1 — GitHub dogfood

**ID:** `M1-GITHUB-DOGFOOD`  
**Status:** in progress (C0 landed 2026-06-07)  
**Full spec:** [product-spec.md](./product-spec.md#milestone-1--specification--composition-dags) (DAGs, C0–C10, decision defaults)

Confirmed 2026-06-07 — first validation target is one small GitHub-hosted project (design partner #1 = yourself). B2D / agency devtools — reputation-first.


## Dogfood repo (GitHub)

| Item | Value |
| --- | --- |
| **GitHub repo** | `monolith-m1-dogfood` (private) |
| **Local clone** | `~/work/monolith-dogfood` |
| **Profile** | Hono (or fetch) Worker; `wrangler.jsonc` with **≥2 bindings** (e.g. D1 + KV); **≥2 stages** in Monolith; baseline `wrangler deploy` succeeds before import |

**Create repo** (requires [GitHub CLI](https://cli.github.com/) — `brew install gh` if missing):

```bash
gh auth login
gh repo create monolith-m1-dogfood --private --description "M1 Monolith/Perch dogfood Worker"
git clone "$(gh repo view monolith-m1-dogfood --json url -q .url)" ~/work/monolith-dogfood
cd ~/work/monolith-dogfood
npm create cloudflare@latest . -- --type hello-world   # then add D1 + KV in wrangler.jsonc
wrangler deploy
```

Tooling lives in `~/work/monolith`; dogfood app is a **separate** GitHub repo for import/plan/deploy validation.


## C0 progress (2026-06-07)

- Root `monolith.run.ts` async stack shell with commented C2–C7 placeholders
- pnpm workspace: `packages/core` (`Stack`, `Resource` types), `packages/cli` (`init|import|plan|deploy` stubs)
- `pnpm monolith --help`, `pnpm typecheck`

## Contract summary

| Field | Value |
| --- | --- |
| **Name** | GitHub dogfood — import → plan → deploy → typed bindings |
| **Owner** | Founder (design partner #1 = self) |
| **Target repo** | Small GitHub TS Worker: `wrangler.toml` or `wrangler.jsonc`; ≥2 bindings {D1, R2, KV, Queue, DO}; ≥2 stages; ≤40h cap |

## Acceptance criteria

| # | Criterion | Test |
| ---: | --- | --- |
| AC-1 | `monolith import wrangler.jsonc` produces valid `monolith.run.ts` + state skeleton | Import exit 0; resources match wrangler bindings |
| AC-2 | `monolith plan --stage dev` shows meaningful diff | ≥1 resource change on first run; stable after deploy |
| AC-3 | `monolith deploy --stage dev` succeeds; HTTP 200 | `curl` smoke + CF dashboard |
| AC-4 | Handler `env` typed from `monolith.run.ts` | `tsc --noEmit` without manual `Env` |
| AC-5 | Second stage plans without corrupting `dev` state | Isolated `.monolith/state/<stage>.json` |
| AC-6 | Friction log below filled (≥3 each: worked / failed / next) | Before M1 marked done |
| AC-7 | Demo script rehearsed for one agency peer | `docs/m1-demo.md` when ready |

## Verification checklist

Copy when marking M1 done:

- [ ] AC-1: `monolith import` on GitHub repo wrangler config → valid `monolith.run.ts` (no hand fix)
- [ ] AC-2: `monolith plan --stage dev` shows meaningful first-run diff
- [ ] AC-3: `monolith deploy --stage dev` → HTTP 200 smoke on configured route
- [ ] AC-4: Handler env typed; `tsc --noEmit` clean without manual `Env`
- [ ] AC-5: `monolith plan --stage <second>` uses isolated state (plan OK)
- [ ] AC-6: Friction log filled (≥3 worked / failed / next)
- [ ] AC-7: `docs/m1-demo.md` rehearsed — willing to show one agency peer
- [ ] Non-goals respected: no npm publish, no second user, no preview SaaS
- [ ] Week-12 metric: logged as 1 design-partner deploy

## Friction log

| | Notes |
| --- | --- |
| **Worked** | C0 scaffold compiles; CLI `--help` lists M1 commands |
| **Failed** | — |
| **Next** | **C1** — wrangler.toml/jsonc parser + golden-file tests → `StackManifest` |

## Artifacts (on done)

| Artifact | Location |
| --- | --- |
| `monolith.run.ts` | Target GitHub repo |
| `.monolith/state/<stage>.json` | Local (gitignored) |
| Plan/deploy logs | `docs/m1-run-log.txt` or excerpts here |
| Demo script | `docs/m1-demo.md` |
| Tool source | This repo (`~/work/monolith`) |
