# Admin Refresh — Audit & Plan

Date: 2026-07-07 · Branch (Phase 2): `feat/admin-refresh` · Status: ✅ **APPROVED, BUILT AND MERGED**
— `feat/admin-refresh` was fast-forward-merged into `main` and pushed (recorded at
[`../admin-roadmap/ROADMAP.md`](../admin-roadmap/ROADMAP.md) batch 0.5). Successor backlog:
`admin-roadmap`, where batches 0/A/B/C1 are done and C2 is next.
*(Header corrected 2026-08-17 — it read "AWAITING APPROVAL" for weeks after the merge.)*

Everything below was verified against source on `main` (post-v122) and live prod state
(Supabase read-only + `railway variables`), not against docs/memory.

---

## 1. Platform inventory (reality from code)

### 1.1 Modes — 10 (`backend/config/mode-registry.js`)

`restaurant`, `appointments`, `commissions`, `service_projects`, `subscriptions`,
`workflow_tickets`, `rentals`, `room_management`, `treatment_plans`, `wholesale`.
Each mode maps to a `feature_flags_to_enable` list (restaurant → 13 flags; most others → 1–2).
Per-tenant state lives in the tenant-schema `tenant_modes` table.

### 1.2 Industry presets — 23 (`backend/config/industry-config.js`)

general_retail, restaurant, salon, grocery, cafe, clinic, repair_shop, gym, wholesale,
photography_studio, butcher, sweet_shop, textile, car_rental, equipment_hire,
furniture_rental, party_supplies, hotel, guesthouse, hostel, dental_clinic, veterinary,
physiotherapy. Each preset carries `modes[]`, labels, portal tabs, and `business_model`.
Per-tenant selection lives in tenant-schema `company_profile.industry_type` — **the public
`tenants` registry has NO industry column** (verified live against prod).

### 1.3 Feature flags — 106 defaults + layered seeding

- `DEFAULT_FEATURE_FLAGS` (`middleware/feature-flags.js`): **106 keys**.
- `fbr_integration` is DB-seeded only — **not** in defaults.
- Expected per-tenant set is the union of **five layers**:
  1. Mode flags — `MODE_REGISTRY[mode].feature_flags_to_enable` for each preset mode.
  2. `PRESET_EXTRA_FLAGS` (`industry-config.js`) — salon/gym/rental/lodging/clinical extras.
  3. Signup bundles (`services/retail-flag-preset.js`): `RETAIL_SEED_FLAGS` (19, for the 6
     `RETAIL_BUNDLE_INDUSTRIES`), `RESTAURANT_SEED_FLAGS` (12, restaurant+cafe),
     `WHOLESALE_SEED_FLAGS` (6, layered on retail), `SALON_SEED_FLAGS` (4),
     `RETAIL_SUBTYPE_FLAGS` (grocery/butcher/sweet_shop/textile engines).
  4. `MULTI_OUTLET_SEED_FLAGS` (5) — flipped on first 1→2 outlet transition.
  5. Manual per-tenant toggles (admin editor / support actions).
- Three preset-apply call paths exist (audit-all-call-paths rule):
  `routes/setup.js` (wizard, seeds bundles), `routes/tier4/company-profile.js` PUT
  (preset switch: resets `tenant_modes`, re-derives mode flags, resets
  `ALL_PRESET_EXTRA_FLAGS` then re-applies extras — does **not** re-run signup bundles),
  and migration backfills.

### 1.4 Workers — 25 pg-boss registrations + 6 setInterval pollers (`boot/workers.js`)

pg-boss (each env-gated, `<NAME>_WORKER_ENABLED=1`): email, fbr, cleanup,
orphan-schema-scan (**default ON**), marketplace-sync, reservation, subscription-grace,
subscription-dunning, rental-overdue, hold-expiry, channel-sync, night-audit,
deposit-hold-expiry, room-overdue, treatment-plan, recall, abc, anomaly, expiry-alert,
retail-digest, shift-auto-close, attendance-auto-close, course-release, kds-snapshot,
reservation-reminder.

setInterval pollers: shopify-sync (30s, opt-out), report-schedule (60s, opt-out),
catalog-scheduler (opt-in), booking-reminders (5m, opt-in), plus daily cleanup trio
(sync events, report artifacts, stale attendance).

**Live Railway state (verified):** 24 of the 25 gated workers are enabled.
**`SHIFT_AUTO_CLOSE_WORKER_ENABLED` is MISSING** → the shift auto-close worker has never
run in prod (exactly the `feedback_worker_env_var_drift` failure mode). Also absent:
`ANTHROPIC_API_KEY` (AI insights dead), `ADMIN_ALLOWED_IPS` (admin IP allowlist = allow
all), `XPAY_*` (`PAYMENT_GATEWAY=sandbox`).

### 1.5 Queues & dead-letter stores

| Store | Schema | Admin coverage today |
|---|---|---|
| `pgboss.job` (email + 24 cron queues) | public | email queue UI only; queue depth per worker partially |
| `fbr_invoices` | public | `GET /api/admin/fbr-health` exists — **no UI** |
| `payment_webhook_events` | public | AdminStuckPayments page ✔ |
| `shopify_webhook_events` | per-tenant | AdminDeadLetters page ✔ (fanout) |
| `external_sync_events` (aggregator inbound `dead_letter` rows — V03 foodpanda/Careem) | per-tenant | **none** |
| `channel_sync_dead_letters` (V10 OTA conflicts) | per-tenant | **none** |
| `email_queue` (legacy) | public | unused — nothing writes to it |
| `infra_cache` | public | orphan-schema snapshot only |

### 1.6 Billing / lifecycle (verified in `routes/billing.js`, `middleware/plan-limits.js`, `routes/admin/billing.js`)

- State machine on `public.tenants`: `payment_status` ∈ trial (45d, `trial_ends_at`) →
  grace (7d, `grace_ends_at`) → expired (writes blocked by `requireActiveSubscription`;
  free plan never blocked). Paid: `active` + `plan_expires_at` (+7d grace on renewal).
- Admin backend: plan-pricing GET/**PUT** (no UI for PUT), record-payment, per-tenant
  payments, upgrade-requests GET/PUT (UI only inside TenantDetail), billing-attention,
  stuck payment-intents. No bulk operations of any kind.
- Prod fleet: 29 active tenants (26 free / 3 pro), **23 = `golv_*` test fleet**, 6 deleted.

### 1.7 Admin surface today

**Backend** — 74 endpoints in 9 files (`routes/admin/`): auth(1), tenants(17: CRUD,
suspend/activate/delete, stats, feature-usage, setup-token ×2, plan-defaults,
feature-flags GET/PUT, notes ×3, migrate, migrate-all, reset-pin), monitoring(6),
billing(8), operations(10: support tickets, impersonate ×2, dead-letters ×2,
payment-dead-letters), compliance(7), messaging(14), system(6).

**Frontend** — 9 pages: Dashboard (infra, stats, attention, billing-attention, revenue,
workers, orphans, backups, announcements, migrate-all), TenantList, TenantDetail (stats,
flat flag list, feature-usage, billing actions, notes, impersonate), SupportTickets,
Emails, DeadLetters (Shopify only), TaxRates, Activity, StuckPayments.

---

## 2. Gap matrix

Severity: 🔴 blind spot with operational risk · 🟠 missing tool, manual workaround exists · 🟡 cosmetic/latency.

| Platform capability | What /admin can see/do today | Gap | Sev |
|---|---|---|---|
| 23 industry presets / 10 modes | Nothing — no industry column, no mode display anywhere | Can't answer "which tenants are restaurants?"; no per-vertical ops view | 🔴 |
| Vertical usage (bookings, contracts, plans, rooms, members, tickets, backorders…) | `feature-usage` = raw action_history counts only | No per-mode adoption counts; can't see if a vertical is actually used | 🟠 |
| 106+1 feature flags | Flat A–Z list; **GET merge iterates defaults only → DB-seeded flags like `fbr_integration` are invisible/un-toggleable** | Parity bug + no grouping | 🔴 |
| `tenant_modes` | No endpoint, no UI | Modes can only be changed by the tenant's own wizard/profile page | 🔴 |
| Preset-expected flag set | Nothing | No drift view; a broken seed (v120 clinic case) is undetectable from /admin | 🟠 |
| Preset re-apply | Nothing (tenant must do it in Settings → Business Profile) | Support can't fix a mis-seeded tenant | 🟠 |
| 25 pg-boss workers + pollers | worker-status covers 27 keys but **misses orphan-schema-scan, shopify-sync, report-schedule**; `enabled` is inferred from heartbeat, not from env | **Cannot detect env-var drift** — SHIFT_AUTO_CLOSE has been silently dead since ship | 🔴 |
| Queue depth | `queue_depth` comes from in-memory heartbeat (0 after redeploy) | Not a real `COUNT(*)` for most workers | 🟡 |
| FBR queue health | Endpoint exists | No UI | 🟠 |
| Aggregator + channel-sync dead letters | Nothing | Failed foodpanda/Careem orders & OTA conflicts invisible platform-wide | 🔴 |
| Trial lifecycle | Per-tenant record-payment only | No bulk extend/expire; managing the 23-tenant golv fleet = 23 manual flows | 🟠 |
| Plan pricing | PUT endpoint exists | No editor UI | 🟠 |
| Upgrade requests / payments | Buried in TenantDetail | No global list views | 🟡 |
| Admin audit | Most mutations logged | Known `logAdminAction` gaps: tax/compliance CRUD, email-queue retry, announcement update, backup verify | 🟠 |
| Admin access hardening | `ADMIN_ALLOWED_IPS` unset in prod (allow-all), no 2FA, 24h token | Single-factor super-admin over the whole fleet | 🟠 |

---

## 3. Build plan (approved scopes a–d)

Conventions for every item: `routes/admin/*` with `requireAllowedIp` + `requireSuperAdmin`,
`logAdminAction` on every mutation, schema-qualified queries with slug re-validation
(`/^[a-z0-9_]{3,40}$/`) before interpolation, per-tenant try/catch on fanout, `adminFetch()`
+ self-contained `--ui-*` styling on the frontend, Vitest integration tests on local PG.

### a. Vertical-aware tenant management

**Backend**
1. `GET /api/admin/tenants` — extend the existing per-tenant enrichment (it already reads
   `company_profile.setup_complete`) to also select `industry_type` from the same row
   (zero extra queries) and add one `tenant_modes` query per tenant → response gains
   `industry_type`, `modes[]`. No migration, no new write path (decision: enrich via
   fanout rather than adding a registry column; revisit only if list latency degrades).
2. New `GET /api/admin/tenants/:id/vertical-usage` — single-tenant counts, one query per
   domain table wrapped in try/catch (missing table ⇒ null): appointments/bookings,
   restaurant checks, service_projects, contracts, workflow tickets, rental contracts,
   room bookings, treatment plans, customer subscriptions (members), wholesale
   backorders, field visits, gift cards/loyalty accounts. Returns `{ mode, count,
   last_activity }` rows.

**Frontend**
3. AdminTenantList: Industry column (display-name map mirrored from
   `INDUSTRY_PRESETS`), industry filter dropdown, mode badges in the row expander.
4. AdminTenantDetail: "Verticals" SectionCard — preset, business model, enabled modes,
   per-mode usage counts from (2).

**Tests**: integration spec seeding a schema with a preset + a few domain rows; asserts
industry/modes in list payload and counts in vertical-usage.

### b. Flag & mode editor parity

**Backend**
1. **Fix** `GET /api/admin/tenants/:id/feature-flags`: merge = union of
   `DEFAULT_FEATURE_FLAGS` keys **and** all DB rows (currently defaults-only → drops
   `fbr_integration` and any future DB-seeded flag).
2. New `GET /api/admin/tenants/:id/modes` (tenant_modes rows ∪ `VALID_MODES`) and
   `PUT .../modes` (toggle one mode; on enable also upsert its `MODE_REGISTRY` flags, on
   disable flip them off — same semantics as company-profile preset apply). Invalidate
   both caches. `logAdminAction`.
3. New `GET /api/admin/tenants/:id/flag-drift` — computes the expected set from the
   five layers in §1.3 (preset modes → MODE_REGISTRY, PRESET_EXTRA_FLAGS, signup bundle
   incl. subtype, multi-outlet bundle if `COUNT(outlets) > 1`) and returns
   `{ expected, missing, extra }`. `extra` is presented as informational (manual opt-ins
   are legitimate), `missing` as drift.
4. New `POST /api/admin/tenants/:id/reapply-preset` — extract the apply sequence from
   `routes/tier4/company-profile.js` PUT into `services/preset-apply.js` and call it from
   **both** call sites (parallel-paths rule; `setup.js` keeps its own signup-bundle path
   deliberately — documented in the service header). Body flag `include_bundles: true`
   optionally re-runs the signup bundle seeders too (that's what fixes a mis-seeded
   tenant). `logAdminAction` + cache invalidation.

**Frontend**
5. AdminTenantDetail flags section rebuilt: grouped by domain (Core, Reports, Retail 2G,
   Restaurant, Appointments, Clinical, Rentals, Lodging, Wholesale, Integrations/Phase 5,
   Foundation engines, Billing/other — static prefix map in the page), search box, drift
   badges (`missing` amber / `extra` gray-info), Modes toggle card, "Re-apply preset"
   button with confirm dialog.

**Tests**: drift computation against a seeded gym tenant (bundle + extras), the GET-merge
fix (seed `fbr_integration` row, assert present), mode toggle cascades, reapply-preset
restores a deliberately broken flag set. Plus one regression test that tenant-side
company-profile PUT still works through the extracted service.

### c. Ops & worker monitoring

**Backend**
1. `boot/workers.js`: build `global.__workerRegistry` while evaluating gates — for every
   known worker record `{ envVar, envValue, gated_on, registered, registerError }`
   (including workers whose env var is unset — that's the whole point). Pollers included.
2. `GET /api/admin/worker-status` rework:
   - Merge `__workerRegistry` → each worker gains `env_var`, `env_enabled`, `registered`.
   - Add missing entries: `orphan_schema_scan`, `shopify_sync`, `report_schedule`.
   - Real queue depth: one grouped query `SELECT name, COUNT(*) FROM pgboss.job WHERE
     state IN ('created','retry','active') GROUP BY name` merged over `PG_BOSS_QUEUES`.
   - Derived `alert` field: `"env_var_missing"` (code gate exists, env unset — catches
     SHIFT_AUTO_CLOSE on day one), `"enabled_but_stopped"` (env on, no heartbeat/DB
     completion within 2.5× interval), `"register_failed"`.
3. Dead letters: extend the fanout to two new sources —
   `GET /api/admin/dead-letters?source=aggregator` (per-tenant `external_sync_events
   WHERE status='dead_letter'`) and `?source=channel_sync`
   (`channel_sync_dead_letters`), same per-tenant try/catch + limit pattern as the
   existing Shopify fanout (precedent: support tickets). Live fanout is acceptable at
   ~30 tenants; if tenant count grows this moves to an `infra_cache` snapshot — noted in
   code comment. Retry/dismiss actions where the domain supports it (aggregator retry
   re-invokes the inject path; channel-sync rows get resolve/dismiss).
4. FBR: no backend work — UI consumes existing `/api/admin/fbr-health`.

**Frontend**
5. Dashboard worker panel rebuilt: grouped (Platform / Billing / Retail / Restaurant /
   Clinical / Rentals+Lodging / Wholesale / Integrations), status pill per worker
   (running / stopped / **env var missing** / register failed), real queue depth,
   processed today. Drift rows float to top with amber banner.
6. AdminDeadLetters: tab bar — Shopify | Payments | Aggregators | Channel sync;
   FBR health card (pending/failed/oldest/avg delay, per-tenant breakdown) added to the
   same page or dashboard.

**Tests**: worker-status shape incl. `env_enabled`/alert derivation (inject fake
registry + pgboss rows), aggregator/channel-sync dead-letter fanout against seeded
schemas.

**Deploy note**: after merge, set `SHIFT_AUTO_CLOSE_WORKER_ENABLED=1` on Railway (or
decide to keep it off deliberately — the new panel will show it either way).

### d. Billing & lifecycle tools

**Backend**
1. `POST /api/admin/tenants/bulk-lifecycle` — body `{ tenant_ids: [], action }` with
   actions: `extend_trial` (`days`, updates `trial_ends_at`, resets
   `payment_status='trial'` if grace/expired), `expire_now` (`payment_status='expired'`),
   `record-payment` stays per-tenant. Per-tenant audit rows + one `logAdminAction`
   summary. Cap batch at 100 ids.
2. Test-fleet endpoints: `GET /api/admin/test-fleet?prefix=golv_` (defaults to `golv_`)
   returning fleet with trial state; bulk delete reuses the existing per-tenant delete
   logic (soft-mark + DROP SCHEMA, slug re-validated) behind an explicit
   `{ confirm: "<prefix>" }` body. Extend-trial delegates to (1).
3. Plan pricing: backend PUT exists — no change.
4. `GET /api/admin/payments?limit&offset` — global `payment_records` list (masterDb).

**Frontend**
5. New `/admin/billing` page: billing-attention lists (moved from dashboard, dashboard
   keeps the summary counts), plan-pricing editor (inline edit → PUT), upgrade-requests
   list with approve/reject, global payments table, link to stuck payments.
6. New "Test fleet" card on `/admin/tenants` (visible when fleet non-empty): count,
   soonest trial expiry, buttons: Extend all +30d / Delete fleet (type-`golv_`-to-confirm).
7. TenantList: bulk-select checkboxes → Extend trial / Expire actions via (1).

**Tests**: bulk-lifecycle transitions (trial→extended, →expired), test-fleet listing +
delete confirm guard, payments pagination.

### Sequencing & commits (Phase 2)

1. `feat(admin): worker registry + worker-status env drift` (c1–c2) — highest operational value, self-contained.
2. `feat(admin): vertical-aware tenant list + detail` (a).
3. `feat(admin): flag/mode editor parity + drift + preset re-apply` (b) — includes the preset-apply service extraction.
4. `feat(admin): dead-letter coverage (aggregator, channel-sync, FBR UI)` (c3–c6).
5. `feat(admin): billing & lifecycle tools + test-fleet manager` (d).
6. `fix(admin): logAdminAction gaps` (suggestion #5, if approved).

Each chunk: integration tests green locally (`backend/` cwd, local PG), UI verified
against local admin with the golv fleet, then push branch. No push to main.

---

## 4. Proposed additions (approve per item)

| # | Item | Verdict | Why |
|---|---|---|---|
| 1 | Feature-adoption matrix (tenants × modes/flags) | **build-now** | Nearly free on top of scope a+b data; hourly worker writes one `infra_cache` snapshot; single new page/panel. Directly drives roadmap. |
| 2 | Targeted announcements (per industry/plan) | **build-now** | Small: `audience_plan`/`audience_industry` columns on `announcements` + filter in `/api/announcements/active`; synergizes with scope a industry data. |
| 3 | Admin action-audit completeness | **build-now** | Tiny, known gap list (tax CRUD, email retry, announcement update, backup verify); closes an audit hole while we're in these files. |
| 4 | Impersonation UX: active-sessions list + one-click revoke | **build-now** | Backend tables/endpoints mostly exist (`impersonation_sessions`, `/end`); small panel on Activity page. Security-relevant. |
| 5 | Tenant health score (activity + errors + worker failures) | **later** | Needs per-tenant error attribution (Sentry tagging exists but no API aggregation here) — do after adoption matrix provides the frame. |
| 6 | Platform analytics dashboard (funnel, activation, MRR/ARR, churn) | **later** | MRR card already exists in revenue-stats; funnel/churn need event history we don't record yet — design the events first, don't fake it from `created_at`. |
| 7 | Admin 2FA + session hardening | **later** | Real project (TOTP enrollment, recovery). Interim mitigations now: document that `ADMIN_ALLOWED_IPS` is unset in prod; consider shorter admin-token TTL when touching auth.js. Flagged, not bundled. |
| 8 | Global cross-tenant search (customer/product/order by phone/email) | **later** | Fanout search is fine at 29 tenants but is a support tool, not an ops gap today. |
| 9 | Email deliverability stats | **later** | Requires Resend API integration; queue-level stats already visible in /admin/emails. |
| 10 | Backup/DR status panel | **skip** | Backup trigger + history + verify already on the dashboard; Supabase PITR is the real DR. A "last backup age" badge can ride along with #1 if wanted. |
| 11 | Rate-limit/abuse dashboard | **skip** | Limiters are in-memory (reset on deploy, nothing persisted) — a dashboard would need new persistence for marginal value at this scale. |

---

## 5. Open questions for approval

1. **Industry via fanout vs. registry column** — plan assumes fanout enrichment (no
   migration). OK, or do you want `tenants.industry_type` synced at wizard completion?
2. **Preset re-apply `include_bundles` default** — default OFF (modes+extras only,
   matching tenant-side behavior) with an explicit checkbox for the full re-seed?
3. **Test-fleet delete** — hard-deletes schemas (irreversible). Keep behind
   type-to-confirm, or exclude delete from Phase 2?
4. **`SHIFT_AUTO_CLOSE_WORKER_ENABLED`** — set it on Railway after the panel ships, or
   was it left off deliberately?
5. Which of §4 items 1–4 are approved to ride along in Phase 2?
