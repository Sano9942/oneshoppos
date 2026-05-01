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

14 P-tier critical bugs found and shipped during the Phase 7 walkthrough (P22 through P35; full P-tier history of the audit reaches P1 → P35, all shipped).
71 ID-tagged M-tier follow-ups + 4 Phase-2 outstanding-medium issues + 5 Phase-2 polish bundles + 8 cosmetic nits + 2 pre-launch verifications still pending. **None are launch-blocking.** All listed below.

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

**71 items total**, accumulated across all 7 phases of the audit. None are launch-blocking. Grouped by category for triage.

> M73-M78 (SEO/OG/PWA-icons cluster) shipped as one bundle in 7.12 — see [phase3-findings-WIP.md](phase3-findings-WIP.md). M27, M28, M29 are also shipped (tax tab + 503→403 alignment, see file header summary). M61, M63 are out-of-scope of this audit.

#### Priority key

- **🔴 medium-elevated** — should pick up before broad rollout / before specific feature flag flips on
- **🟡 medium-low** — visible to customers, fix when touching the area
- **⚪ low** — true polish; safe to leave unbounded

#### POS  (10 — mostly visible to cashiers)

| ID | What | Priority |
|---|---|---|
| M10 | No "Share receipt" button in Sales History detail panel | ⚪ low |
| M11 | Sales History detail panel missing Email + WhatsApp buttons | ⚪ low |
| M12 | POS WhatsApp share embeds receipt-template `header_text` instead of company name | 🟡 medium-low |
| M34 | Customer display shows hardcoded "SanoPOS" instead of tenant name | 🟡 medium-low |
| M35 | `/kiosk` doesn't accept hardware-keyboard numeric input | 🟡 medium-low |
| M36 | Customer display state is in-memory (lost on Railway restart) | ⚪ low |
| M37 | `/customer-display` accepts any `shift_id` value with no validation | ⚪ low |
| M38 | Customer display is undiscoverable for tenants | ⚪ low |
| M55 | Receipt slip shows `Invoice: PENDING` forever after sync | 🟡 medium-low |
| M56 | Checkout modal doesn't surface offline state to cashier | 🟡 medium-low |

#### Admin panel  (5)

| ID | What | Priority |
|---|---|---|
| M41 | Tenant Detail renders `max_employees:0` literally; looks like quota=zero | 🟡 medium-low |
| M42 | Plan Pricing UI shows `starter/*` rows that shouldn't exist | 🟡 medium-low |
| M43 | Activity dropdown missing `feature_flag_toggled` and other action types | ⚪ low |
| M44 | Revenue Stats card reads 2 field names the API doesn't return | 🟡 medium-low |
| M45 | Tenant Activity tab shows zero rows because tenants haven't done anything | ⚪ low |

#### Billing  (5 — customer-visible)

| ID | What | Priority |
|---|---|---|
| M5  | Cap-modal pricing line conflicts with /billing pricing cards | 🟡 medium-low |
| M6  | Add Employee form opens at-cap with no preflight warning | 🟡 medium-low |
| M22 | `/billing` Quarterly default conflicts with Annual BEST VALUE pill | 🟡 medium-low |
| M23 | `/api/billing/pricing` still returns Starter tier rows | 🟡 medium-low |
| M24 | `period_end` ISO timestamp shown verbatim on payment_records | ⚪ low |

#### Storefront  (4)

| ID | What | Priority |
|---|---|---|
| M30 | Empty storefront state by default | ⚪ low |
| M31 | Storefront order placement does not enqueue customer email confirmation | 🟡 medium-low |
| M32 | Storefront has zero discovery link to customer portal/signup | ⚪ low |
| M33 | Anonymous storefront orders not auto-linked to customers on signup | 🟡 medium-low |

#### Returns  (4)

| ID | What | Priority |
|---|---|---|
| M1  | Sales History does NOT show return-linked status | 🟡 medium-low |
| M2  | "Returned Stock" nav label is misleading | ⚪ low |
| M3  | Process Return UI is product-first, not sale-lookup-first | 🟡 medium-low |
| M4  | `processed_by_employee_id` is NULL after admin Returns submit | 🟡 medium-low |

#### Workers  (4)

| ID | What | Priority |
|---|---|---|
| M39 | Worker heartbeat globals are process-memory; lost on Railway restart | ⚪ low |
| M40 | `subscription_grace` and `catalog_scheduler` heartbeats not in worker-status | ⚪ low |
| M62 | `retail-digest-worker-boss.js` dedup check is broken | 🟡 medium-low |
| M71 | worker-status `lastPollAt:null` ambiguous between "broken" and "no cron since boot" | ⚪ low |

#### Import  (5)

| ID | What | Priority |
|---|---|---|
| M16 | Excel scientific-notation barcode silently truncated | 🟡 medium-low |
| M17 | Misleading error wording for non-numeric `selling_price` | ⚪ low |
| M18 | Customer import accepts invalid email format silently | 🟡 medium-low |
| M19 | Customer import accepts duplicate mobile silently | 🟡 medium-low |
| M21 | XLSX auto-coerces ISO date strings into Excel serials | 🟡 medium-low |

#### Dark mode  (5 — UX-visible)

| ID | What | Priority |
|---|---|---|
| M50 | Pre-render loading screens flash bright white in dark mode | ⚪ low |
| M51 | Input + Select primitives hardcode `bg-white`, breaking dark mode globally | 🟡 medium-low |
| M52 | NotificationBell + ContextSwitcher + PlanLimitModal hardcode white surfaces | 🟡 medium-low |
| M53 | POSRedesign hardcodes `bg-[#F8FAFC]` — main area stays light in dark mode | 🟡 medium-low |
| M54 | Dashboard "Needs Attention" rows poor contrast against dark surface | ⚪ low |

#### Gift cards  (3)

| ID | What | Priority |
|---|---|---|
| M13 | Public gift card page shows balance with no currency symbol | 🟡 medium-low |
| M14 | Gift card UI doesn't allow custom codes | ⚪ low |
| M15 | Gift card tender renders as raw `gift_card` on receipts | 🟡 medium-low |

#### Backup / DR  (3)

| ID | What | Priority |
|---|---|---|
| M64 | Super-admin backup excludes `pgboss` schema | ⚪ low |
| M66 | Tenant `/backup-restore` UI says "restore" but is export-only | ⚪ low |
| M79 | `POST /api/admin/backup/verify` only accepts local paths, not R2 keys | ⚪ low |

#### Infra  (2)

| ID | What | Priority |
|---|---|---|
| M46 | pg-boss `job_common` table has 1045 dead tuples + only 1 autovacuum today | 🟡 medium-low |
| M65 | R2 backup retention strategy (versioning / 2nd bucket / cross-cloud) | ⚪ low |

#### Integrations  (2)

| ID | What | Priority |
|---|---|---|
| M7 | WhatsApp API Token input is `type=text`, not `password` | 🟡 medium-low |
| M8 | Pull Orders / Sync Products propagate upstream errors with HTTP 500 | 🟡 medium-low |

#### Docs / repo  (2)

| ID | What | Priority |
|---|---|---|
| M59 | `frontend/CLAUDE.md` mis-describes `api.js` 401 behavior | ⚪ low |
| M60 | `frontend/src/CLAUDE.md` mislocates global ErrorBoundary mount | ⚪ low |

#### Single-item categories (16)

| ID | Category | What | Priority |
|---|---|---|---|
| M9  | Onboarding | "Make your first sale" step gates on TODAY's sale count, not lifetime first sale | 🟡 medium-low |
| M20 | Customers | Customer name uniqueness not checked | ⚪ low |
| M25 | Tenants | Tenant deletion does NOT purge pg-boss jobs that reference the tenant | 🟡 medium-low |
| M26 | Products | `GET /api/products` (list) drops the `gst` field | 🟡 medium-low |
| M47 | FBR | 4 fbr-invoice jobs stuck `failed` in pg-boss + likely `fbr_invoices` table | 🟡 medium-low |
| M48 | Mobile | Sidebar in icon-rail mode crops "SANOPOS" brand text mid-letter | ⚪ low |
| M49 | PWA | Install prompt cannot be verified on real iOS via Playwright (manual verify required) | ⚪ low |
| M57 | Sandbox | Payment success doesn't auto-redirect for non-billing-upgrade flows | ⚪ low |
| M58 | Flags | 3 ghost flags in `DEFAULT_FEATURE_FLAGS` with no runtime gates | ⚪ low |
| M67 | Legal | Pakistan-locale clauses missing (PECA, FBR retention, jurisdiction) | 🟡 medium-low |
| M68 | Support | Tenants don't see own attached screenshots in `/my-tickets` | ⚪ low |
| M69 | Notifs | `low_stock` notifications spam on duplicate stock states | 🟡 medium-low |
| M70 | Email | Confirmation email truncates message mid-word at 200 chars | ⚪ low |
| M72 | Security | `tier4/company-profile.js` + `treatment-plans.js` upload paths share P31/P32 hazards | 🔴 medium-elevated — fix before either flag flips on for any tenant |
| M80 | Perf | Landing page Lighthouse Performance 84 (target ≥ 90) — likely hero imagery | ⚪ low |
| M81 | A11y | WCAG 2.1 AA color-contrast: 11 landing CTAs + 7 POS pre-flight nodes | ⚪ low |
| M82 | Tests | Test stub `createTestApp-pg.js:211` returns 503 instead of production's 403 | ⚪ low |

#### Quick stats

- **🔴 medium-elevated**: 1 (M72 — gate before any tenant flips `phase4_company_profile_upload` or `phase4_treatment_plans` flags on)
- **🟡 medium-low**: ~32 — fix when touching the area
- **⚪ low**: ~38 — true polish, no urgency

### Phase 2 walkthrough — un-ID'd findings (also deferred, NOT launch-blocking)

The Phase 2 sidebar walkthrough captured several findings as **named bundles in prose** rather than discrete M-tier IDs. They live in [pre-launch-walkthrough-plan-2026-04-27.md](pre-launch-walkthrough-plan-2026-04-27.md) "Phase 2 — Day 2" section + [phase2-day2-findings-detailed.md](phase2-day2-findings-detailed.md). Pulled in here for completeness.

#### 4 Phase-2 outstanding medium issues (functional)

| # | Page | Issue | Priority |
|---|---|---|---|
| P2-MED-1 | Insights → Accounting | `GET /api/accounting/cashflow/daily?from=…&to=…` returns **400** on page load. Possible feature-flag gap or validation bug. Cash Flow tab data broken on first hit. | 🟡 medium-low |
| P2-MED-2 | Stock Control → Inventory Audit | Page largely blank below title — no KPIs, no table, no empty state. Plus breadcrumb/title mismatch ("Stock Counts" vs "Inventory Audit") and outline-style CTA. Half-finished page. | 🟡 medium-low |
| P2-MED-3 | Online Store → Storefront | Empty-state copy says "Try adjusting your search or filters" but real issue is products aren't published (need rows in `channel_publications`). UX trap for new tenants who see 5 sample products in Inventory but empty storefront. Misleading copy + no clear path from Inventory to publish. | 🟡 medium-low |
| P2-MED-4 | Admin → Billing | "BEST VALUE" pill on Annual (17% off, save PKR 16k) but **Quarterly** card is pre-selected with green border. Default cycle should match the recommended pill. Code comment says "Annual cycle is RECOMMENDED_CYCLE" — UI doesn't match. | 🟡 medium-low |

#### Subtitle pattern bundle — lowercase-leading on 9 pages

| Page | Source | Current text |
|---|---|---|
| Brands | `BrandsRedesign.jsx:103` | "**brand** taxonomy with consistent CRUD and search behavior." |
| Taxes | `TaxesRedesign.jsx:105` | "**tax** profiles with default control and fast editing." |
| Attribute Sets | `AttributeSetsRedesign.jsx:176` | "**variant** schema management with nested attributes and options." |
| Promotions | `PromotionsRedesign.jsx:312` | "**manage** discount rules and test promotion outcomes on sample carts." |
| Purchase Orders | — | "**manage** supplier ordering lifecycle from draft to GRN." |
| Stock Adjustments | — | "**auditable** shrink/gain adjustments per outlet." |
| Transfers | — | "**stock** movement between outlets with full traceability." |
| Returned Stock | — | "**supplier** return (RMA) workflow and stock-out tracking." |
| Supplier Payables | — | "**monitor** supplier outstanding balances and record invoice payments." |

Priority: ⚪ low. Single-commit cleanup. Capitalize the leading word.

#### Subtitle pattern bundle — missing trailing period (10 pages)

Inventory Audit, Approvals, Reports, Chart of Accounts, Credit/Debit Notes, Post-Dated Cheques, Attendance, Integrations, Tax Lookup, Courier Settings, Barcode Templates, Receipt Templates, FBR Settings, My Tickets. Priority: ⚪ low. Single-commit cleanup.

#### Nav-vs-title mismatch bundle (6 pages + 2 breadcrumb-case)

| Sidebar/breadcrumb | Page title |
|---|---|
| "Stock Counts" (URL slug) | "Inventory Audit" |
| "HR" | "HR Management" |
| "Company Profile" | "Company **Settings**" |
| "Barcode Templates" | "Barcode Label Designer" |
| "Backup" (breadcrumb) | "Backup & Restore" |
| "Tax Lookup" | "Tax Rate Lookup" |
| FBR breadcrumb shows **"Fbr"** | should be "FBR" |
| Chart of Accounts breadcrumb shows **"Chart Of Accounts"** | should be "Chart of Accounts" |

Priority: 🟡 medium-low (visible everywhere, looks unpolished). Pick canonical name per page; update both nav-config + page heading.

#### Layout drift bundle — older pages with no design-system adoption (4 pages)

| Page | Drift |
|---|---|
| Price Lists | No KPI strip, simpler search-only layout, outline-style CTA |
| Review Moderation | No subtitle, no KPIs, no primary CTA — most stripped-down page in Inventory |
| Inventory Audit | Largely blank below title, no KPIs, no table, no empty state |
| Printer Settings | Bare HTML form, no design-system primitives, blue Save Settings CTA |

Priority: 🟡 medium-low. Each is a half-day rewrite to match the redesign system.

#### CTA color drift bundle (5+ button styles across primary actions)

- **Green-fill** (correct, design-system standard): Add Product, Add Category, Save Profile, Add Lead, etc.
- **Green-outline**: Print Labels (Barcode Templates)
- **Blue**: New Template (Barcode Templates), Add Custom Courier (Courier Settings), Apply (Attendance), Save Settings (Printer Settings), Connect (Integrations)
- **Purple/violet**: New Template (Receipt Templates), Shop Now (Storefront)
- **White-outline**: Refresh (multiple)
- **Outline-style "+ New X" that should be green-fill**: Price Lists, Inventory Audit, Chart of Accounts, Credit/Debit Notes, Post-Dated Cheques

Priority: 🟡 medium-low. Standardize on green-fill primary + slate-outline secondary. ~1 day cleanup commit.

#### Cosmetic nits (8 standalone observations)

| Observation | Where | Priority |
|---|---|---|
| Stock display `100.000` (trailing zeros from v45 NUMERIC widening) | Products list | ⚪ low |
| `GST %` hardcoded label (country-coupled to PK) | Add Product → Pricing | 🟡 medium-low |
| `outlet #1` ID leak in body text instead of outlet name | Notifications row | 🟡 medium-low |
| Login bootstrap 401 on `/api/context/bootstrap` | Login → dashboard redirect | ⚪ low |
| Reports subtitle missing space ("acrosssales") + lists "restaurant" reports for retail | Reports page | ⚪ low |
| Revenue Forecast chart width(-1)/height(-1) sizing race | Reports page | ⚪ low |
| Post-Dated Cheques 3 silent 503s on bootstrap (suppliers, customers, cheques/upcoming) | Post-Dated Cheques | 🟡 medium-low — same fix-pattern as Day-1 fix #5 |
| Action History blank Action/Entity columns for login events | Action History | ⚪ low |

#### Pre-launch verifications still pending (deferred)

| # | What | Status |
|---|---|---|
| V1 | Fresh-tenant signup to verify provisioner inserts Default Tax 0% with `is_default=true` (Day-1 fix #3 verification on livetest1 was inconclusive — pre-fix residue) | Not yet run. Easy: signup throwaway tenant, query `taxes` table, verify, delete. |
| V2 | Investigate making v69 migration idempotent against partial-schema state before onboarding any real existing tenants | Investigation deferred — livetest1 will get nuked eventually so it's not blocking. Hidden trap for any future migration that touches the same area. |

### Phase 1 walkthrough — closed clean

Per [pre-launch-walkthrough-plan-2026-04-27.md](pre-launch-walkthrough-plan-2026-04-27.md) Phase 1 section: 11 critical/important findings discovered during signup + setup-wizard walkthrough. All 11 shipped same-day in commit `d517d56` and one follow-up commit. Doc explicitly states "_None outstanding — all Phase 1 items fixed and deployed_". No deferred items from Phase 1.

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
