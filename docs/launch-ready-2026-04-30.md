# Launch-readiness — 2026-04-30

**Status:** READY for launch.

This doc captures the final state of production after the Phase 7 pre-launch
walkthrough (`docs/pre-launch-walkthrough-plan-2026-04-27.md`) and the
Phase 8 cleanup. Everything in scope is shipped, verified, or explicitly
deferred with rationale. Intended as a one-stop "are we ready?" reference.

References:
- Walkthrough plan: [pre-launch-walkthrough-plan-2026-04-27.md](pre-launch-walkthrough-plan-2026-04-27.md)
- All findings (P-tier + M-tier with full evidence): [phase3-findings-WIP.md](phase3-findings-WIP.md)
- Memory anchors: `feature_flag_seed_lifecycle.md`, `production_state.md`, `tax_architecture.md`

---

## Production environment

| Surface | URL / endpoint | Status |
|---|---|---|
| Frontend | `https://sanopos.com` (Vercel, custom domain — `sanopos.vercel.app` still works as fallback) | Live |
| Backend  | `https://api.sanopos.com` (Railway) | Live |
| Super-admin | `https://sanopos.com/admin` | Live (sano9942@hotmail.com) |
| Database | Supabase Postgres Pro (project `tpjewvfoqtskscmwjtjj`) — daily auto-backups + 7-day PITR + 8 GB storage | Healthy |
| Object storage | Cloudflare R2, bucket `sanopos-uploads` | Healthy, prefixes `support/` and `backups/` empty post-cleanup |
| Email | Resend (`RESEND_API_KEY` on Railway, sender `noreply@sanopos.com`, custom-domain SPF/DKIM/DMARC verified) | Working — Phase 7.9 verified delivery to Gmail Inbox post-P28 |
| Error tracking | Sentry (`SENTRY_DSN` on Railway, `VITE_SENTRY_DSN` on Vercel) | Working |
| Uptime | UptimeRobot pinging `/api/health` every 5 min | Active |
| Latest schema migration | v84 (P33 backup_log column union, shipped 2026-04-29) | Live |
| Latest commit on `main` | `d00fd29` (docs(phase7): close 7.14.5) | Pushed |

## Tenants

After Phase 8 cleanup, production has **one active tenant** plus the platform super-admin.

| Tenant | Role | Plan | Status | Note |
|---|---|---|---|---|
| `livetest1` (id 95) | Demo / internal testing | Pro (annual) | active | **Kept on purpose.** Used for post-launch testing of bugfixes and demoing paid features. Has 2 outlets (Branch 2 was added Phase 6.7), 4 employees, ~9 products incl. Test Coffee with image, 6 sales (id 25 through 31, sale 26 voided), 1 customer group, 1 open shift since 2026-04-27, multi-outlet flags ON, all 19 retail flags ON via `seedRetailFlags`. |
| `livetest2` (id 96) | Half-completed signup | — | **deleted** 2026-04-30 22:08 UTC | Schema dropped + `tenants` row marked `deleted`. Audit row 208 in `tenant_audit_log`. |

Important operator notes for livetest1:
- Open shift on outlet 1 since 2026-04-27 — kept open intentionally so testing flows can keep selling.
- 4 completed `payment_intents` rows for annual upgrades — kept as billing-flow demo data.
- `phase2g_loyalty=true`, `phase2g_gift_cards=true`, `phase2g_holds=true` and 16 other retail flags ON. All 5 multi-outlet flags ON. Reflects a tenant that completed the wizard as `general_retail` and added a 2nd outlet.
- See `production_state.md` memory entry for live-as-of-now numbers if/when these change.

## Phase 7 walkthrough — final scoreboard

23 P-tier critical bugs found and shipped during the walkthrough.
15 M-tier follow-ups logged; none are launch-blocking. All listed below.

### P-tier (critical) — all FIXED + LIVE-VERIFIED

| ID | Walk | Bug | Fix commit |
|---|---|---|---|
| P22 | 7.0 | Daily sales-summary buckets attributed to UTC date instead of merchant timezone | `4f784f9` |
| P23 | 7.3 | R2 image proxy: split-host URL bug + Express 5 wildcard array param + same-origin CORP blocked browser render | `f00d900` + `61337f3` |
| P24 | 7.3 | Storefront API/frontend snake_case mismatch | (bundled) |
| P25 | 7.6 | Dockerfile missing `postgresql17-client` so `pg_dump` not on PATH; backup endpoints returned 500/503 | `52a7292` |
| P26 | 7.8 | `AdminSupportTickets` rendered `[object Object]` for screenshots — admins couldn't see attachments | `c353796` |
| P27 | 7.8 | Admin support reply INSERTed into a non-existent `notifications.employee_id` column with silent catch — tenant bell never pinged | `807add7` |
| P28 | 7.9 | `loadTenantAndPerms` SELECTed only `(role_id, name)`; `req.employee.email` undefined; support confirmation Resend silently skipped — zero confirmation emails ever sent | `b9072eb` |
| P29 | 7.10 | `app.set("trust proxy", 1)` was too few hops on Railway; `req.ip` rotated across edge-router IPs; auth/webhook rate limiters never tripped 429 | `850870e` |
| P30 | 7.10 | `webhookLimiter` was wired in `deps` but never applied to any of the 4 webhook routes (xpay, meta, whatsapp, daraz) | `85bbd0c` |
| P31 | 7.11 | SVG XSS on `/api/support/upload` → session-takeover (Playwright-verified TAKEOVER_RESULT carried valid access JWT) | `e44b024` |
| P32 | 7.11 | `/api/support/upload` trusted client-supplied MIME with no magic-byte verification — DOS-MZ EXE renamed `.jpg` landed on R2 as `image/jpeg` | `cbd7286` |
| P33 | 7.13 | `backup_log` column drift across code/schema/prod; every INSERT in silent try/catch; audit rows lost; cross-tenant leak on `/api/backup/log` and `/api/backup-status` | `6106c33` (+ migration v84) |
| P34 | 7.14.2 | 2 `<select>` elements on POS pre-flight surface lacked `aria-label` — screen-reader-blocking. Bonus: `SupportWidget` label-to-select linkage. | `09048d1` |
| P35 | 7.14.5 | `/api/loyalty/tiers` CRUD + nav + page were not gated by `phase2g_loyalty` — admin/loyalty-tiers reachable when feature off | `7bb7f8d` |

### M-tier (polish) follow-ups, deferred — NOT launch-blocking

| ID | Walk | What | Cost to fix | Priority |
|---|---|---|---|---|
| M64 | 7.6 | Super-admin backup excludes `pgboss` schema | 1-line change | low |
| M65 | 7.6 | R2 backup retention strategy (versioning / 2nd bucket / cross-cloud) | infra config | low (R2 holds <1 MB total) |
| M66 | 7.6 | Tenant `/backup-restore` UI copy says "restore" but is export-only | UI copy or feature lift | low |
| M67 | 7.7 | Pakistan-locale legal clauses (PECA, FBR retention, jurisdiction) | content + UI | medium-low |
| M68 | 7.8 | Tenants don't see their own attached screenshots in `/my-tickets` | UI | low |
| M69 | 7.8 | `low_stock` notifications spam on duplicate stock states | dedupe in producer | low |
| M70 | 7.9 | Confirmation email truncates message mid-word at 200 chars | template fix | low |
| M71 | 7.9 | Worker-status `lastPollAt: null` ambiguous between "broken" and "no cron since boot" | UI distinction | low |
| M72 | 7.11 | `tier4/company-profile.js` and `treatment-plans.js` upload paths share P31/P32 hazards (off-by-default flags) | adopt `rasterImageFileFilter` + `verifyImageMagicBytes` before flag-on | medium (gate before flipping flags) |
| M79 | 7.13 | `POST /api/admin/backup/verify` only accepts local file paths; can't verify R2 keys | route enhancement | low |
| M80 | 7.14.1 | Landing page Lighthouse Performance 84 (target ≥ 90) — likely hero imagery | image optimization | low |
| M81 | 7.14.2 | WCAG 2.1 AA color-contrast: 11 nodes on landing emerald CTAs + 7 nodes on POS pre-flight | CSS palette tweaks | low |
| M82 | 7.14.5 | Test stub `createTestApp-pg.js:211` returns 503 instead of production's 403 (drift from M29) | 3-line stub fix + narrow regression assertion | low |

> M73-M78 (SEO/OG/PWA-icons cluster) shipped as one bundle in 7.12 — see [phase3-findings-WIP.md](phase3-findings-WIP.md) entries. They are P-tier-equivalent fixes (PWA install was broken pre-fix) but were classified M because individually low-impact; the cluster fix landed in `2d3189e`.

### Phase 7.14 decisions (5 items, all closed)

| Item | Decision | Rationale |
|---|---|---|
| 7.14.1 Performance baseline | DONE | Lighthouse 84/93/96 (landing/login/POS), CWV all green. Sale latency median 664ms over 5 real production sales. |
| 7.14.2 A11y smoke | DONE | axe across 5 surfaces; P34 fixed + live-verified, M81 logged. |
| 7.14.3 AI insights | CONFIRMED OFF | 3-layer verification: frontend gate, backend `ANTHROPIC_API_KEY` unset on Railway, DB has 0 `ai_insights` rows. Aligns with `project-ai-deferred` (Mar 27). |
| 7.14.4 PWA installed-mode | VERIFIED WORKING | CDP `Page.getInstallabilityErrors` returned `[]`. M76 fix delivers — Chrome will offer install on engagement. |
| 7.14.5 Loyalty tiers ungated | FIXED | P35 — backend gate + nav-config flag + page redirect. Live-verified flag OFF→403, flag ON→200. |

## Phase 8 — cleanup outcome

| Sub-phase | Action | Result |
|---|---|---|
| 8.1 livetest2 | Deleted via `DELETE /api/admin/tenants/96` | Schema dropped, soft-delete on master, audit row 208 |
| 8.2 livetest1 baseline | **SKIPPED** by decision | Tenant kept as populated demo / internal-testing tenant |
| 8.3 Phase 4 leftovers (portal customer, gift cards) | **SKIPPED** by decision | Stay as part of livetest1 demo state |
| 8.4 close shift / clear attendance | **SKIPPED** by decision | Open shift on outlet 1 stays for ongoing testing |
| 8.5 R2 + DB walk-test artifacts | DONE | 1 email_queue orphan + 1 notification + 3 support tickets + 13 R2 support uploads + 2 R2 backup `.dump` files. Total: **5 DB rows + 15 R2 objects deleted.** |
| 8.6 launch-ready doc | This file | — |

`backup_log` row 1 deliberately **kept** as live evidence the audit pipeline works after P33.

## Known caveats / operator notes for post-launch

1. **livetest1 is a real tenant in production.** It will appear in the super-admin tenant list, in any "all tenants" reports, and in MRR if you run revenue queries. Filter it out (`slug != 'livetest1'`) or accept it as an internal demo tenant.
2. **Open shift on livetest1 outlet 1.** Shift summary reports for outlet 1 will look unbalanced until the shift closes. Easy fix: log into livetest1, close the shift via POS. Or leave open if testing.
3. **`phase2g_loyalty` defaults to false for non-`general_retail` presets.** Only `general_retail` signups auto-flip the loyalty flag (and 18 others) ON via `seedRetailFlags`. Other retail presets (grocery, wholesale, butcher, sweet_shop, textile) and non-retail presets (clinic, restaurant, etc.) ship with the flag OFF — Loyalty Tiers nav hidden by default, admin must flip per tenant. This is correct per the audit; document for future tenants who ask "where's loyalty?".
4. **`ANTHROPIC_API_KEY` is intentionally unset on Railway.** AI insights stays disabled until and unless this gets set. Don't set it without confirming the AI deferral decision is being reversed.
5. **`backup_log` table now has the unioned 13-column shape.** Migration v84 is live everywhere. New tenant provisions also get this shape via `schema-pg.sql`.
6. **Rate-limit trust proxy = 2.** This is the right value for Railway's current edge architecture. If Railway changes their proxy chain length, set `TRUST_PROXY_HOPS` env var to override. (P29.)
7. **Super-admin support ticket replies write notifications now.** Pre-P27 they silently dropped. If a tenant claims they got no notification on an old ticket, that's why.
8. **CDP-installable but not auto-prompted.** Browser PWA install only fires after Chromium's user-engagement heuristic (~30s + revisit). Don't expect headless / first-load to show the install prompt.

## Open commits not yet pushed at the time of this doc

None. As of writing, `origin/main` is at `d00fd29`. All Phase 7 + Phase 8 commits are pushed and deployed.

## Next session

The walkthrough plan and `phase3-findings-WIP.md` are the canonical record of the audit. Any post-launch incident should reference back to those. New work belongs in a fresh phase doc, not appended here.
