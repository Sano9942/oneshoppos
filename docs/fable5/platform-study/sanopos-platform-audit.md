# SanoPOS Platform Audit — What It Is, Where It Lives, How It Works

> Compiled 2026-07-06 by tracing the actual source code (signup → provisioning → seeding →
> wizard → flags → runtime), not from docs alone. Pure description — no judgment, no gap
> analysis (that's a future doc). Companion to `modern-pos-playbook.md` in this folder:
> Part 2 uses the same category structure (extended from 8 to 12, because SanoPOS has
> areas the Square playbook didn't cover) so the two can be read side by side later.
>
> Verified against: `tenant-provisioner-pg.js`, `routes/auth.js` (signup),
> `routes/setup.js`, `config/industry-config.js`, `config/mode-registry.js`,
> `services/retail-flag-preset.js`, `middleware/feature-flags.js`, `middleware/tenant-auth.js`,
> `middleware/plan-limits.js`, `middleware/permissions.js`, plus the July-2026 CLAUDE.md tree.

---

# PART 1 — The life of a tenant (chronological walkthrough)

## Step 0 — What exists before any tenant

One Supabase Postgres database. The `public` schema holds the **platform layer**: the
tenant registry (`tenants`, `super_admins`, `tenant_audit_log`, `tenant_refresh_tokens`),
billing tables (`plan_pricing`, `payment_records`, `payment_intents`, `upgrade_requests`),
cross-tenant queues (`email_queue`, `fbr_invoices`, `pgboss.*`), platform ops tables
(`admin_activity_log`, `admin_security_log`, `announcements`, `impersonation_sessions`,
`infra_cache`, `tenant_notes`). Every tenant will get its own **Postgres schema**
(`tenant_<slug>`) containing a full copy of the ~400-table DDL from `schema-pg.sql`.

One Node/Express process on Railway serves all tenants. One React/Vite bundle on Vercel
serves all tenants. There is no per-tenant code, container, or deployment — isolation is
entirely at the schema level.

## Step 1 — Signup (`POST /api/auth/signup`, routes/auth.js:800)

Gated by `MULTI_TENANT=1` + `SELF_SERVICE_SIGNUP=1`. In order:

1. **In-memory IP rate limit** (5/hour window per IP, `signupLimits` Map).
2. **Cloudflare Turnstile CAPTCHA** — enforced only when `TURNSTILE_SECRET_KEY` is set (prod).
3. **Slug derivation** — store name lowercased, all non-alphanumerics stripped, max 30 chars
   ("Live Test 1" → `livetest1`). Duplicate slug → 409.
4. **Provisioning** (see Step 2) with placeholder PIN `0000` and timezone UTC.
5. **Plan assignment** — every signup lands on the **Free plan** (`plan='free'`,
   `payment_status='active'`, no trial clock; limits from `PLAN_DEFAULTS.free`:
   1 outlet / 3 employees / 100 products). Pro is reached later via the /billing upgrade flow.
6. **Legal consent recorded** — `tos_version`, `privacy_version`, `consent_at`, `consent_ip`
   written on the tenant row.
7. **Admin employee updated** — owner name, email, bcrypt password hash written into the
   tenant schema's `employees` row created by the provisioner.
8. **Email verification gate** — a `email_verification_token` UUID is generated; the response
   does NOT include the setup token. The merchant gets a verify link by email (Resend);
   `POST /api/auth/verify-email` exchanges the verified token for the **setup token**.
9. **Drip emails enqueued** — `drip_getting_started` at day 2, `drip_features` at day 5,
   via pg-boss `email_queue`.

If the merchant never completes setup, the **cleanup worker** deletes the tenant after 7 days.

## Step 2 — Provisioning (`tenant-provisioner-pg.js:provision()`)

What physically gets created, in one atomic transaction per schema:

1. `CREATE SCHEMA tenant_<slug>` (autocommit, outside the transaction — PgBouncer quirk;
   failures are caught by the orphaned-schemas admin sweep).
2. Inside one `BEGIN…COMMIT` with `SET LOCAL search_path`:
   - **The entire `schema-pg.sql` DDL** — every table the platform knows, regardless of
     vertical. A barber shop's schema contains `kds_stations`, `rental_contracts`,
     `treatment_plans`, `field_visits` — all empty, all gated off by flags.
   - **`schema_version` pre-seeded with every migration version** — so the boot-time
     migration runner never replays v1..vN against a fresh schema.
   - **Seed rows**: 1 outlet (named after the store) · 1 `Administrator` role with a fixed
     10-permission list · 1 admin employee (bcrypt PIN hash, `role` text column set
     explicitly) · employee↔outlet link · `company_profile` row (id=1) with a 48-hour
     `setup_token` and `setup_complete=false` · one 0% "Default Tax" marked default.
3. A second transaction against `public`: insert the `tenants` registry row + a
   `tenant_audit_log` 'created' entry.
4. On any failure: rollback + best-effort `DROP SCHEMA … CASCADE`.

Note what is NOT seeded here: no feature-flag rows, no modes, no products, no categories.
The tenant at this point runs entirely on `DEFAULT_FEATURE_FLAGS` code defaults.

## Step 3 — The setup wizard (`POST /api/setup/complete`, routes/setup.js)

The merchant clicks the verify link, lands on the wizard (frontend `/setup?token=…&tenant=…`),
and the completion handler — the single most consequential write in the tenant's life —
runs in one transaction:

1. **Company profile filled in**: name, country, city, phone, timezone, currency symbol+code,
   fiscal year start, cash denominations, **`tax_mode`** (the P8 tax stance), NTN/STRN.
2. **Industry preset applied** — `industry_type` is validated against
   `config/industry-config.js`, which defines **23 presets** (general_retail, restaurant,
   salon, grocery, cafe, clinic, repair_shop, gym, wholesale, photography_studio, butcher,
   sweet_shop, textile, car_rental, equipment_hire, furniture_rental, party_supplies, hotel,
   guesthouse, hostel, dental_clinic, veterinary, physiotherapy). Each preset carries:
   - `business_model` (buy_sell / food_service / service_appointment / …)
   - `modes[]` — which of the 10 platform modes it activates
   - `labels` — vocabulary remapping (restaurant: product→"Menu Item", customer→"Guest")
   - `dashboard_widgets` — which dashboard cards render
   - `onboarding_steps` — the checklist shown post-setup
   - `pos_layout_mode` (grid vs list) and `pos_search_config`
   - `visible_report_groups` — which report sections appear
3. **Modes seeded** — one `tenant_modes` row per preset mode. The **10 modes**
   (`config/mode-registry.js`): restaurant, appointments, commissions, service_projects,
   subscriptions, workflow_tickets, rentals, room_management, treatment_plans, wholesale.
4. **Mode-derived flags flipped ON** — `getFeatureFlagsForModes()` maps each mode to its
   flag bundle (restaurant mode alone enables 13 `phase4_restaurant*` flags) and upserts
   `feature_flags` rows.
5. **Country-pack compliance flags** — e.g. Pakistan pack auto-enables FBR-related flags.
6. **Industry flag bundles** (`services/retail-flag-preset.js`):
   - retail/grocery/wholesale → `RETAIL_SEED_FLAGS` (19 flags: omni input, variant picker,
     price override, POS approvals, risk controls, gift cards, loyalty, holds, inventory
     intelligence, label designer, draft orders, item suggestions, COD reconciliation,
     shipping automation, SMS providers + campaigns, weekly digest…)
   - restaurant/cafe → `RESTAURANT_SEED_FLAGS` (12 flags: loyalty, gift cards, SMS pair,
     price override, approvals, risk controls, digest, COD + shipping, draft orders —
     mandatory POS plumbing for kitchen flows — and delivery_aggregators)
   - wholesale additionally → `WHOLESALE_SEED_FLAGS` (6: credit controls, field sales,
     schemes, secondary sales, backorders, van sales — all latent until configured)
7. **Outlet renamed/created**, and for restaurant/cafe a **default KDS station**
   ("Main Kitchen") is seeded so send-to-kitchen works out of the box.
8. **Sample data seeded** (`seeds/preset-seed-data.js`) — preset-appropriate categories +
   products, wrapped in a SAVEPOINT so failure is non-fatal.
9. **Default roles ensured** (id 1/2/3 = Administrator/Manager/Cashier) and
   **`DEFAULT_ROLE_PERMISSIONS` seeded** per role.
10. **Admin employee finalized** with the real name + chosen PIN, and an auto-login JWT is
    signed so the merchant lands directly in the app.

`setup_complete=true` is the switch: until it's set, `loadCompanyProfile` blocks every
non-setup route with 503 `SETUP_REQUIRED`.

**The three-stage flag lifecycle** (this is the full picture):
- Stage 1 (signup): zero flag rows — code defaults from `DEFAULT_FEATURE_FLAGS` apply
  (~15 ON by default: backup, accounting_core, CRM quotations, advanced HR, notifications,
  approvals, marketplace_integrations, smart collections, report builder, POS layouts…;
  everything vertical-specific OFF).
- Stage 2 (wizard): preset flips 19–35+ flags ON depending on industry (modes + industry
  bundle + country pack).
- Stage 3 (growth): first transition from 1→2 outlets flips `MULTI_OUTLET_SEED_FLAGS`
  (5 flags: context selection/enforcement, outlet pricing, outlet visibility, price books).
  Later still, upgrades/admin can toggle anything per tenant from the super-admin panel.

## Step 4 — Every request thereafter (the runtime spine)

A logged-in merchant's every API call passes through the 20-step middleware chain
(`index.js` + `registerAllRoutes.js`):

```
helmet → cors → json(rawBody for webhooks) → uploads/R2 → compression → cookies
→ globalLimiter (skips POS hot paths) → requestId
→ [admin / webhooks / customer-portal / manufacturer-portal mount HERE — no tenant context]
→ loadTenantAndPerms   JWT {tid, eid, rid, oid, scope, jti} → req.employee, req.employeePerms
→ resolveTenant        tenant lookup → AsyncLocalStorage.run({db: tenantDb}) → deps.db proxy live
→ tenant /uploads → loadCompanyProfile (5-min cache → req.company) → resolveContext (x-outlet-id → req.context)
→ [ALL tenant business routes]
→ per-route: requirePerm/requireAnyPerm → requireFeature/requireMode → validate(zod)
→ requirePlanLimit (POST caps) → requireActiveSubscription (blocks writes when expired)
```

The core trick of the whole platform: **`deps.db` is a Proxy over AsyncLocalStorage** —
route code writes `deps.db.query(...)` with no tenant awareness, and the ALS context wired
by `resolveTenant` routes it to the right `tenant_<slug>` schema. A route author never
touches tenancy.

Five parallel auth universes exist, each with its own JWT secret/scope and middleware:
1. **Employees** (`JWT_SECRET`, scope full/kiosk) — the main app.
2. **Super-admin** (`routes/admin/`, IP-allowlisted, own login + token) — platform ops.
3. **Customer portal** (`CUSTOMER_PORTAL_JWT_SECRET`, scope "customer") — buyer self-service.
4. **Manufacturer portal** (`MANUFACTURER_PORTAL_JWT_SECRET`, scope "manufacturer") —
   brand partners see onward-sales, city-only PII.
5. **No-auth public** — receipts, storefront, public bookings/reservations/QR menu,
   gift-card balance, country packs, webhooks (only xPay HMAC-verified).

## Step 5 — What the merchant actually touches

**Frontend** (one React 19 + Vite 7 + Tailwind v4 bundle, `frontend/src/`):
- `App.jsx` composes routes from `routes/{publicRoutes,appRoutes,adminRoutes}.jsx`.
- `auth/AuthProvider.jsx` patches `window.fetch` globally — every `/api/` call gets auth
  headers + silent token refresh; `api.js` is the typed service layer on top.
- `contexts/PresetContext.jsx` delivers the preset downstream: `labels` (so a restaurant
  UI says "Guests"), `hasMode()`, `pos_layout_mode`, `unit_vocabulary`. The sidebar
  (`ui/nav-config.js`) + `useFeatureFlags()` decide which nav entries render.
- The working surface is `pages/redesign/*` (~all active pages, post-Square-reskin on
  `ui/primitives.jsx` + `--ui-*` tokens). POS is `POSRedesign.jsx` + `pos/POSContext.jsx`
  (~8 domain hooks composed behind `usePOS()`, F-key shortcuts, `cartMath.js` pure functions).
- Verticals get their own page clusters: restaurant floor/KDS/kiosk, field-rep PWA
  (`redesign/field/`), treatment plans, rentals, rooms, portal (`pages/portal/`),
  storefront (`pages/storefront/`), super-admin (`pages/admin/`).
- `utils/offlineQueue.js` — IndexedDB queue for sale/return/check_in/field_order when offline.

**Backend** — the merchant's tenant can reach ~110 route files (see Part 2 map). Which ones
*respond* is decided per-request by the flag/mode/perm/plan gates; the code itself is
identical for every tenant.

## Step 6 — Background machinery (no request involved)

`boot/workers.js` starts ~20 pg-boss workers + setInterval pollers: email queue, FBR
invoice posting (exponential backoff), marketplace sync, cleanup (dead tenants), orphan
schema scan, ABC classification, anomaly detection, attendance/shift auto-close, hold
expiry, reservation reminders, subscription grace transitions, retail digest, backup.
Each worker loops over active tenants (`withTenantContext()`) — tenants don't own workers;
the platform sweeps them. Heartbeats surface at `GET /api/admin/worker-status`.

On every deploy, `start.sh` runs `migrate-pg.js`: public schema first, then every active
tenant schema sequentially, per-tenant failures logged but non-blocking, plus the
unconditional RLS sweep over public tables.

---

# PART 2 — The category map (12 categories; playbook's 8 + 4 SanoPOS-specific)

The playbook's 8 categories apply, plus 4 more this platform needs: **multi-tenancy**,
**billing/subscription lifecycle**, **integrations**, and **platform operations** —
areas Square-the-company has too but that the playbook folded into other topics.

## 1. Code organization

Two-package repo: `backend/` (Express, ~110 route files + ~60 services + ~20 workers) and
`frontend/` (one Vite app). Backend is a **modular monolith organized by domain file**, not
by layer: `routes/<domain>.js` (HTTP) → `services/<domain>.js` (logic) → shared schema.
Sub-clusters where a domain outgrew one file: `routes/admin/`, `routes/reports/`,
`routes/shopify/`, `routes/integrations/`, `routes/tier4/`, `routes/customer-portal/`,
`routes/manufacturer-portal/`, `routes/restaurant/`. Routes are factory functions
`(app, deps) => {}` registered by `registerAllRoutes.js`. Zod schemas live one-per-domain
in `schemas/`. Documentation is a CLAUDE.md tree (root + 10 per-directory guides, rebuilt
bottom-up July 2026). Boundaries are convention (deps pattern, per-directory guides) —
there is no static boundary-enforcement tool.

## 2. Data model

Single DDL source of truth: `schema-pg.sql` (~400 tables), copied whole into every tenant
schema. The spine every vertical shares: `products` (+variants, +serials, +batches via F07,
+kits via F01), `sales`/`sale_items`/`sale_payments` (per-line tax snapshot, `timestamp`
column), `customers`, `employees`, `outlets`, `outlet_stock`. Verticals **extend** the
spine with their own tables (restaurant checks/KDS, rental contracts, room folios,
treatment plans, field visits, backorders) but sales always land in `sales`. Established
disciplines in code: price/tax snapshots on sale lines, wage-relevant data on attendance
rows, `SELECT … FOR UPDATE` on stock/credit hot paths (reservation.js, credit.js,
batch-stock.js), pg-boss `singletonKey` dedup on renewals, status-column state machines
(orders, contracts, plans, tickets — enforced per-route). Money/quantity columns are
NUMERIC (returned as strings by pg — `Number()` convention).

## 3. Multi-tenancy (SanoPOS-specific category)

**Schema-per-tenant** on one shared Postgres: `tenant_<slug>` schemas + `public` platform
schema. Request routing = JWT `tid` → `tenantDbManager.getDb()` → per-query
`search_path` → ALS-proxied `deps.db`. Connection: one 20-connection pool through
Supabase's transaction pooler (Supavisor, port 6543) shared by all tenants — no
session-level PG features allowed. `?tenant=<slug>` is accepted only on an explicit
public-path allowlist (`PUBLIC_TENANT_PARAM_PATHS`). Tenant states: active / suspended /
deleted (403 codes each). RLS on all public tables blocks the Supabase auto-API.
Cross-schema fanout (admin, workers, migrations) iterates tenants explicitly.

## 4. Verticals & gating

Four-layer gate, all data-driven:
1. **Industry preset** (23, `industry-config.js`) — chosen once at wizard, mutable later
   via `PUT /api/company-profile` (re-seeds mode flags). Carries labels/layout/widgets/steps.
2. **Modes** (10, `mode-registry.js`, `tenant_modes` table) — coarse vertical switches;
   `requireMode()` middleware; empty table falls back to flags-only (back-compat).
3. **Feature flags** (~130 keys, `feature_flags` table merged over `DEFAULT_FEATURE_FLAGS`,
   60s cache) — `requireFeature()` per route; frontend `useFeatureFlags()` drives nav.
   Seeded in the 3-stage lifecycle (signup defaults → wizard preset → growth triggers),
   toggleable per tenant from super-admin.
4. **Plan** (free/pro on the tenant row) — `requirePlanLimit` caps outlets/employees/products
   on POST; `requireActiveSubscription` blocks all writes when expired (free plan exempt).

One flag key namespace serves rollout, entitlement, mode-derivation, and setting duties
simultaneously; which job a key does is documented in comments per key.

## 5. Permissions & auth

Permission strings (≈40) grouped by role rows (`roles` + `role_permissions` tables).
Shipped roles: Administrator (`all_access`), Manager (broad ~23-perm set), Cashier
(3 perms), Field Rep (1 perm). Roles are editable per tenant (roles page); permission
checks are `requirePerm`/`requireAnyPerm` server-side and `hasPerm()` client-side.
POS-specific identity: dashboard login is password (JWT 24h + rotating refresh 7d,
SHA-256-hashed at rest, jti revocation); kiosk is PIN-only with a restricted "kiosk"
token scope; POS re-auth mid-session is PIN (`/api/employees/validate-pin`); manager
overrides (void/comp/price) verify a manager PIN inline (`services/manager-pin.js`,
refuses impersonating admins). Five separate JWT universes (employee, super-admin,
customer, manufacturer, none) as described in Part 1 Step 4.

## 6. Time & labor

`attendance_sessions` (+ `employee_attendance`) record clock-in/out — written in **local
time** by design (contrast: sales in UTC). Clock-in surfaces: kiosk PIN
(`/api/attendance/pin-checkin`, public with `?tenant=`), in-app, and field-rep GPS+selfie
check-in (`field_visits`, geofence radius from `company_profile.field_geofence_meters`,
haversine in `services/geo.js`). Scheduling lives in `schedules.js` + F06's classes/
resources engine; commissions accrue per-line via `commission-calc.js` into
`commission_earnings` (tips pool distributions land in the same table). Attendance
auto-close and shift auto-close are workers. POS checkout can require an open shift +
clocked-in cashier (`getEmployeeCheckoutStatus` in sales.js).

## 7. POS client

One React SPA route (`POSRedesign.jsx`) backed by `pos/POSContext.jsx` — a single context
composing ~8 domain hooks (cart, customer, park, payments, restaurant check, shortcuts…)
exposed via `usePOS()`. Cart math is extracted to pure functions (`pos/cartMath.js`).
Layout is preset-driven (grid for retail, list for restaurant; per-device quick grids via
`pos-layouts`). Restaurant POS overlays the same context with floor plan/table sessions/
check lifecycle (draft_orders as the check backbone). Pricing on the server: `/api/sales`
recomputes lines through the unified pricing path (price lists cascade → group/tier →
promotions → tax snapshot). Keyboard-first (F1–F10 shortcuts). Receipts render from DB
on demand (`utils/receipt.js`, public share URL, WhatsApp link, email).

## 8. Offline

`frontend/src/utils/offlineQueue.js`: IndexedDB queue holding four operation types —
`sale`, `return`, `check_in`, `field_order` — captured when fetch fails, replayed on
reconnect. The field-rep PWA is the primary offline consumer (offline check-in + order
capture queueing); the main POS uses it as a fallback rather than an offline-first design.
Catalog is not locally replicated; the app requires connectivity for lookups. Payments
are cash-first in the Pakistani market, so offline card capture is not in scope.

## 9. Billing & subscription lifecycle (SanoPOS-specific)

Plans: **free** (forever, 1/3/100 caps) and **pro** (45-day trial → grace 7d → expired
read-only). State machine columns live on the tenant row (`plan`, `payment_status`,
`trial_ends_at`); transitions run in the email worker's hourly billing check, which also
sends `trial_warning`/`trial_ended`/`account_locked`/renewal emails. Enforcement =
`requireActiveSubscription` (writes blocked when expired) + `SubscriptionBanner.jsx`
globally in the UI. Payment paths: manual (super-admin records payment) or gateway
(`services/payment-gateway.js` adapter — xPay live, sandbox for tests; checkout intent →
redirect → HMAC-verified webhook → auto-activation + payment record + email).
Upgrade requests (manual path) reviewed in the super-admin panel.

## 10. Integrations (SanoPOS-specific)

Hub at `/settings/integrations` (flag `marketplace_integrations`). Adapter pattern
everywhere, all credentials AES-256-GCM (`enc:v1:` format) in `integration_settings`:
- **Marketplaces**: Shopify (deepest — own route cluster, HMAC webhooks, order/product/
  inventory sync), WooCommerce, Daraz, Meta/Facebook commerce, WhatsApp (messaging),
  Google Merchant (feed).
- **Couriers**: 13 adapters (leopards, tcs, blueex, trax, callcourier, mnp, postex, rider,
  swyft, bykea, pakpost, dhl, fedex) behind `BaseCourierAdapter`.
- **Payments**: xPay + sandbox behind `BasePaymentAdapter`. **SMS**: generic HTTP + Twilio
  adapters. **Compliance**: FBR Digital Invoicing (queue + worker + backoff + dashboard).
- **AI**: `/api/insights/ask` (Claude) + `/api/insights/auto` cards.
Inbound webhooks all land in `routes/webhooks.js` before tenant middleware.

## 11. Platform operations (SanoPOS-specific)

The super-admin panel (`/admin`, `routes/admin/`, IP-allowlisted): tenant CRUD/suspend/
delete, per-tenant flag editor, plan/billing management, payment recording, impersonation
(short-lived jti-revocable JWT + amber banner + audit), support tickets + replies, email
queue, dead letters, announcements/broadcasts, tenant notes, worker status, orphaned-schema
scan/cleanup, infra monitor (pg_stat_activity, schema sizes, slow queries), backups
(pg_dump → R2). Observability: Pino structured logs with request IDs, Sentry (tagged
tenant+request), in-memory alerting → Resend email on error spikes / DB pressure,
UptimeRobot on `/api/health`.

## 12. Shipping it

Tests: Vitest backend integration suites (isolated `test_<hex>` schema per test via
`createTestApp-pg.js`, local Postgres via `.env.test`), unit tests both sides, Playwright
production E2E + smoke suites (`frontend/tests/`). Deploys: push to main → Railway
(backend; `start.sh` = TZ + migrate-all-tenants + boot with route-existence assertions)
and Vercel (frontend) auto-deploy. Migrations are an in-repo versioned array
(`migrate-pg.js` `MIGRATIONS`, currently v113) run against public + every tenant on every
deploy; provisioner keeps `schema-pg.sql` in lockstep so new tenants skip the replay.
Async side effects ride pg-boss (email, FBR, sync, reminders); no event bus — direct
service calls + queues.

---

# PART 3 — Where everything lives (domain map with load-bearing files)

Active code only. Grouped by domain; the named files are the ones you'd touch to change
behavior. (Legacy/dead material listed at the end.)

## Backend

| Domain | Load-bearing files |
|---|---|
| **Boot & config** | `index.js` (orchestrator), `routes/registerAllRoutes.js` (mount order + inline health/flag routes), `boot/workers.js`, `start.sh`, `config/industry-config.js` (23 presets), `config/mode-registry.js` (10 modes) |
| **Tenancy engine** | `tenant-db-proxy-pg.js` (ALS proxy — THE trick), `tenant-db-manager-pg.js`, `master-db-pg.js` (registry), `tenant-provisioner-pg.js`, `db-pg.js` (pool), `migrate-pg.js` (v1–v113) |
| **Auth & identity** | `jwt-auth.js`, `routes/auth.js` (login/refresh/signup/verify/reset), `middleware/tenant-auth.js` (the 4-step chain), `middleware/customer-auth.js`, `middleware/manufacturer-auth.js`, `services/manager-pin.js` |
| **Gating** | `middleware/feature-flags.js` (defaults + requireFeature/requireMode), `middleware/permissions.js` (roles + requirePerm), `middleware/plan-limits.js`, `services/retail-flag-preset.js` (seed bundles), `scripts/reconcile-mode-flags.js` |
| **Onboarding** | `routes/setup.js` (the wizard transaction), `seeds/preset-seed-data.js`, `routes/country-packs.js`, `seed-admin-pg.js` |
| **POS core** | `routes/sales.js` (checkout, pricing, snapshots, shift gate), `routes/returns.js`, `routes/parked-sales.js`, `routes/shifts.js`, `routes/draft-orders.js`, `services/pricing.js`, `services/quote.js` (storefront engine), `services/approval-policy.js` |
| **Catalog & inventory** | `routes/products.js`, `routes/categories.js` + `category-tree.js`, `routes/inventory.js` (transfers/adjustments), `services/kit-engine.js` (F01), `services/batch-stock.js` (F07 FEFO), `services/reservation.js`, `services/inventory-intelligence.js`, `routes/purchase-orders.js`, `routes/grn.js` |
| **Customers & engagement** | `routes/customers.js`, `routes/loyalty.js`, `routes/gift-cards.js`, `services/marketing.js`, `services/messaging.js`, `services/sms.js`, F05 notification dispatch (`services/notifications/*`) |
| **Labor** | `routes/attendance.js`, `routes/employees.js`, `routes/schedules.js`, `routes/commissions.js` + `services/commission-calc.js` (F06), `routes/roles.js` |
| **Restaurant** | `routes/restaurant.js`, `routes/restaurant/` (pay-at-table, reservations, waitlist, void-comp…), `routes/kds.js`, `services/restaurant-{checks,floor,kds}.js`, `services/modifiers.js`, `services/tips.js`, `services/menu-schedule-resolver.js` |
| **Service verticals** | `routes/bookings.js` + `services/booking-*.js`, `routes/service-tickets.js`, `routes/rentals.js` + `services/rental-service.js`, `routes/rooms.js` + `services/room-service.js`, `routes/treatment-plans.js` + `services/treatment-plan-service.js`, `services/deposit-engine` (F04), packages (F02), forms (F03) |
| **Wholesale/B2B** | `routes/field.js` + `services/geo.js`, `services/credit.js`, `services/backorder.js` (V02 split point), `services/moq.js`, `services/product-visibility.js`, `routes/manufacturer-partners.js` + `routes/manufacturer-portal/`, `routes/customer-invoices.js` + `services/customer-invoicing.js` |
| **Omnichannel** | `routes/storefront.js` + `services/storefront-cart.js`, `routes/orders.js`, `services/allocation.js`, `routes/fulfillment.js`, `routes/couriers.js` + `services/couriers/` (13 adapters), `routes/customer-portal/` |
| **Integrations** | `routes/integrations/` (hub + 4 channels), `routes/shopify/` + `shopify/`, `routes/woocommerce.js`, `services/marketplace/`, `services/crypto.js`, `routes/webhooks.js` |
| **Compliance & tax** | `routes/taxes.js`, `routes/fbr.js` + `services/fbr.js` + `workers/fbr-worker-boss.js`, `routes/tax-lookup.js`, `routes/outlet-tax-profiles.js` |
| **Money & billing** | `routes/billing.js`, `services/payment-gateway.js`, `routes/tier4/accounting.js`, `services/subscriptions.js`, `routes/admin/billing.js` |
| **Reports & insights** | `routes/reports/` (15 modules; `sales.js` largest), `routes/insights.js`, `routes/insights-ai.js`, `routes/report-builder.js` |
| **Platform ops** | `routes/admin/` (8 modules), `services/alerting.js`, `services/logger.js`, `middleware/request-id.js`, `utils/backup-pg.js`, `swagger.js` |
| **Async machinery** | `services/boss.js`, `workers/` (~20 `*-worker-boss.js` + `tenant-job-context.js`), `services/email.js` + `email-templates.js` |

## Frontend (`frontend/src/`)

| Domain | Load-bearing files |
|---|---|
| **Shell** | `App.jsx`, `routes/{public,app,admin}Routes.jsx`, `api.js`, `config.js`, `auth/AuthProvider.jsx` (global fetch patch), `auth/*Store.js` (4 session stores) |
| **Design system** | `ui/primitives.jsx` (PageShell/SectionCard/Button…), `--ui-*` tokens, `ui/nav-config.js` (sidebar), `utils/theme.js` (dark mode) |
| **Context layer** | `contexts/PresetContext.jsx` (labels/modes/layout), `contexts/CurrencyContext.jsx`, `contexts/ToastContext.jsx`, `hooks/useFeatureFlags.js` |
| **POS** | `pages/redesign/POSRedesign.jsx`, `pages/redesign/pos/POSContext.jsx` (+8 hooks), `pos/cartMath.js`, `utils/receipt.js`, `utils/offlineQueue.js` |
| **Back office** | `pages/redesign/*Redesign.jsx` (~70 active pages — products, customers, inventory, purchasing, HR, settings…), `pages/reports/` + `Reports.jsx`, `pages/dashboard/` |
| **Vertical clusters** | `pages/redesign/field/` (field-rep PWA), restaurant pages + kiosk, `pages/redesign/treatment/`, rentals/rooms/tickets pages |
| **Other surfaces** | `pages/admin/` (super-admin), `pages/portal/` (customer), `pages/storefront/`, public pages (Landing, Signup, ResetPassword, ReceiptPublicPage, verify-email) |
| **Tests** | `frontend/tests/*.spec.js` (Playwright prod E2E), `frontend/tests/smoke/`, `frontend/tests/unit/` |

## Legacy / dead — do not use

- `backend/archive/` + `backend/archive/legacy/` — SQLite era, historical only.
- `backend/schema.sql`, `schema_dump.txt`, `_endpoint_list.txt`, `BACKEND-AUDIT.md` — superseded artifacts.
- `backend/tenant-db-pg.js` — older ALS proxy kept for compatibility; new code uses `tenant-db-proxy-pg.js`.
- `frontend/src/pages/*Route.jsx` thin wrappers — composition shims, never edit.
- `frontend/src/pages/LandingPage.jsx` + 8 landing variants — dead since the Phase-5 reskin.
- Some `backend/schemas/` files unwired to routes (e.g. `pos-devices.js`) — verify with grep before trusting.
- `smoke-gate.test.js` — pre-existing failures, quarantined.

---

## One-screen summary

SanoPOS is a **schema-per-tenant modular monolith**: one Express app + one React bundle
serving every tenant, isolation via Postgres schemas routed by an AsyncLocalStorage proxy.
A tenant is born in a signup → email-verify → wizard pipeline; the wizard is the moment of
truth where one of 23 industry presets fans out into modes (10), feature flags (~130 keys,
3-stage seed lifecycle), vocabulary, POS layout, sample data, and roles. At runtime every
request passes a 20-step middleware chain ending in four data-driven gates (perm → flag/mode
→ validation → plan/subscription), so the same codebase renders as a barber shop, a
restaurant, or a wholesale distributor purely through data. Verticals extend one shared
sales/product/customer spine with their own tables; background pg-boss workers sweep all
tenants; a super-admin panel operates the platform; and migrations replay against every
tenant schema on every deploy.
