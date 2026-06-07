# Monolith — branding & positioning

**Product name:** Monolith  
**Portfolio id:** Perch (internal experiment tracker only)  
**Version:** v0.3.0 — Effect-native core shipped 2026-06-07

---

## Name decision

| Name | Role | Recommendation |
| --- | --- | --- |
| **Monolith** | Public product, npm scope `@monolith/*`, CLI `monolith`, repo `armancharan/monolith` | **Use for all public-facing work** |
| **Perch** | Portfolio / consignment experiment id (`perch.yaml`) | Internal only — do not lead marketing |
| **Plinth** | Backup codename from early spec | Retired |

**Recommendation:** Ship as **Monolith**. Perch stays in portfolio YAML for calendar/kill-rule tracking. Avoid dual-branding on the website, npm, or GitHub — one catalytic slab, one name.

---

## Tagline options

1. **TypeScript IaC for Cloudflare teams who outgrew wrangler.toml**
2. **Plan, drift, deploy — Effect-native reconcile for Workers**
3. **One typed stack. Wrangler deploys it.**
4. **Infrastructure that compiles — D1, KV, DO, Queues in one run file**
5. **Cloudflare lifecycle without Terraform ceremony**

Primary pick for hero: **#1** (problem-first). Secondary for developer audience: **#2**.

---

## Audience

| Segment | Pain | Hook |
| --- | --- | --- |
| **B2D / platform engineers** | wrangler.toml drift, no plan step, binding typos | import → plan → deploy with typed `monolith.env.d.ts` |
| **Agencies on CF** | Multi-stage (dev/prod/pr-*), hand-rolled CI | Preview stages + GitHub Action template |
| **Effect-native CF teams** | Want Layers/services, not ad-hoc scripts | `@monolith/effect`, `MonolithLive`, tagged errors |

Not targeting: Vercel-style hosting buyers, Canva-adjacent creatives, or Terraform-first infra teams.

---

## Voice

- **Utilitarian, dense** — show commands and diffs, not lifestyle marketing
- **Honest scope** — partial destroy, shared preview bindings, wrangler as deploy engine
- **Not Vercel** — no gradients, no “deploy in seconds” fluff, no pill buttons
- **Magpie-adjacent UI** (site + future docs theme):
  - Square corners (`border-radius: 0`)
  - Panels `#fafafa` on `#fff`, borders `#111` 1px
  - Monospace accents for CLI / code (`ui-monospace`, `SF Mono`, `Consolas`)
  - Thin borders, generous whitespace, black/white with minimal accent

---

## Domain strategy

| Domain | Status (2026-06-07) | Notes |
| --- | --- | --- |
| `monolith.dev` | **Taken** (A records → Vercel-style host) | Not available |
| `monolithstack.dev` | **Likely available** (no DNS) | Recommended primary — descriptive, `.dev` TLD |
| `usemonolith.dev` | **Likely available** (no DNS) | Good fallback / CTA domain |
| GitHub Pages | **Available now** | Interim: `armancharan.github.io/monolith` or custom domain later |

**Recommendation:** Register `monolithstack.dev` when ready; ship interim site from `website/` via GitHub Pages. Point `usemonolith.dev` → same site as optional redirect.

---

## Visual direction

**Metaphor:** 2001 monolith — one catalytic slab that transforms how the tribe builds.

| Element | Direction |
| --- | --- |
| **Palette** | Black `#111`, white `#fff`, panel `#fafafa`, accent none or single `#333` |
| **Typography** | System sans for prose; monospace for product name, CLI, version |
| **Shape** | Rectangles only — no pills, no blobs, no glassmorphism |
| **Imagery** | Optional: minimal black rectangle / slab SVG; avoid sci-fi clipart |
| **Logo** | Wordmark `MONOLITH` in monospace caps, or `monolith` lowercase mono — defer icon until domain locked |

Reference: Magpie design rules (square, thin borders, utilitarian density).

---

## Competitor positioning (one-liners)

| vs | One-liner |
| --- | --- |
| **Alchemy** | Monolith is Wrangler-native and Effect-first — plan/drift on your existing wrangler project, not a parallel runtime. |
| **wrangler alone** | wrangler deploys; Monolith plans, detects cloud drift, types bindings, and gates deploy on diff. |
| **SST / Pulumi on CF** | No second deploy engine — Monolith reconciles through wrangler subprocess you already trust. |

---

## Launch checklist (branding)

- [x] Product name locked: Monolith
- [x] v0.3.0 GitHub release
- [ ] npm publish (`@monolith/cli`, `@monolith/effect`, `@monolith/hono` — see [publishing.md](./publishing.md))
- [x] Minimal landing page (`website/index.html`)
- [ ] Domain registered (`monolithstack.dev`)
- [ ] GitHub Pages deploy enabled (workflow stub in `.github/workflows/deploy-website.yml`)
- [ ] AC-7 demo rehearsed (`docs/m1-demo.md`) — optional pre-GTM

---

## Links

| Resource | URL |
| --- | --- |
| GitHub | https://github.com/armancharan/monolith |
| Release v0.3.0 | https://github.com/armancharan/monolith/releases/tag/v0.3.0 |
| Getting started | [getting-started.md](./getting-started.md) |
| Product spec | [product-spec.md](./product-spec.md) |
