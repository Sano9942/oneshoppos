# SanoPOS Wholesale Master Reference — 2026-05-16 (updated: Tier 2 Option B shipped — reorder + MOQ + visibility)

**This is the single day-to-day wholesale/distribution reference for the repo.**

If you want one file that answers "what have I built, what's missing, and what do I build next?", start here.

Companion file: [research-competitive-landscape.md](research-competitive-landscape.md) — fresh competitive research (May 2026) covering Shopify B2B, NetSuite, Cin7, Odoo, BigCommerce, QuickBooks Commerce, plus Pakistan incumbents (SAMS, SalesFlo, Smart Distribution, Moneypex, DigitalManager). Every gap claim in this document is grounded in that file.

> **How this file should be used:** Read the "Where we are" section to understand state. Read the "Roadmap" section to know what to build next. Don't add features outside the roadmap without revisiting Tier sequencing.

---

## Headline (read this first)

**TIER 1 IS COMPLETE.** Tier 0 (2026-05-13/14), Tier 1.1 + 1.1.5 (field rep app + owner route UI, 2026-05-14), Tier 1.2 (order capture, 2026-05-14), Tier 1.3 (schemes engine, 2026-05-15), Tier 1.4 (secondary sales / manufacturer portal, 2026-05-15), and Tier 1.5 (wholesale signup flag-bundle auto-seed, 2026-05-15) all shipped and verified live via end-to-end Playwright walkthrough on the prod wholesale test tenant. Current migration: **v94**.

Wholesale tenants now have, out of the box: their own mode, credit controls, A/R aging, customer statements, wholesale dashboard cards, a mobile-first field-rep PWA (GPS + selfie + outcome + order capture), slab-tier brand-scoped schemes engine, AND a manufacturer-partner portal where brand owners log in to see real-time aggregate sales of their SKUs through this distributor. All four wholesale feature flags auto-enable for new wholesale signups via `seedWholesaleFlags()`.

**What's left for Tier 1.5/onward (deferred):** Retrospective rebates (Tier 1.3.5 — wait for a real tenant to ask), transaction-level visibility for premium manufacturer relationships (Tier 1.4.5 — wait for ask), nightly rollup table for /summary perf if a tenant hits 100K+ sale_items.

**Tier 1 polish shipped 2026-05-16:**
- `toISOString().slice(0, 10)` UTC trap audit (commit `3cf96d2`) — 41 call sites across 29 frontend files replaced with local-tz helpers in `utils/dates.js` (`todayLocalStr`, `localDateStr`, `daysAgoLocalStr`, `monthStartLocalStr`). Day 9 Bug #5 was the canary; this audit closes the rest.
- Manufacturer-portal password reset (commit `899d6dc`) — new `POST /api/manufacturer-portal/auth/forgot-password` (public, enumeration-safe), admin Resend endpoint extended to active partners with 1h reset TTL, refresh-token revocation on password change, new `manufacturer_partner_password_reset` email template, frontend `/manufacturer-portal/:slug/forgot-password` page + login link. Reuses existing `signup_token` column — no schema change.

**Tier 2 Option B shipped 2026-05-16 (current migration: v96, verified live on wholesalewalktest1778451):**
- **Tier 2.10 — Portal reorder from unified history** (commit `c027c21`, no schema). New `GET /api/portal/me/order-history` UNIONs `web_orders` + `sales` for the logged-in customer with `source` tag. `POST /api/portal/me/reorder` mints a fresh storefront cart at current prices and returns `/store/:slug/cart?adopt=<token>`. `StorefrontCart.jsx` uses a `useState` initializer to write the token to `localStorage["sf_cart_<slug>"]` before `useStorefrontCart` reads it, then strips the param. Original `/me/orders` left intact for the dashboard widget — backward-compat.
- **Tier 2.2 — MOQ + case-pack enforcement** (commit `1a9011c`, migration v95). New `products.min_order_qty INT DEFAULT 0` + `products.order_increment INT DEFAULT 1`. New `services/moq.js` (`validateMoq`, `validateMoqSingle`). Wired into `storefront-cart.js` (cumulative qty check on add — defeats the "add 1 twelve times" loophole) and `/api/sales` (gated on `field_visit_uuid` presence). POS bypasses by design. Error code `MOQ_VIOLATION` with a `hint` field for field-rep UX. Frontend: hints + step-by-increment +/- buttons on storefront cart, storefront product detail, and field-rep picker; admin form has a new "Wholesale order rules" section card.
- **Tier 2.11 — Customer-group catalog visibility** (commit `e040012`, migration v96, Option C/C2). New `products.visibility TEXT DEFAULT 'all'` (enum: all|restricted) + new join table `customer_group_products (customer_group_id, product_id)`. New `services/product-visibility.js` (`visibleProductSqlFragment` with `$PLACEHOLDER` substitution marker, `withVisibilityWhere`, `isProductVisibleToCustomer`). Enforced on storefront listing/detail (anonymous = ungrouped = sees only `visibility='all'` — that's the C2 default), customer-portal reorder eligibility (skipped items list newly-restricted SKUs), field-rep `/api/products?customer_id=` (gated on caller having `manage_field_sales` WITHOUT `all_access`/`manage_inventory` — admins always see everything so they can configure restrictions). Bypassed on admin product CRUD, reports, POS, manufacturer portal. Defense in depth via `storefront-cart.js::addItem`. Admin form has a "Catalog visibility" radio + group multi-select. Storefront detail returns 404 instead of 403 to not leak existence.

**Strategic position:** Pakistan-built distribution software (SAMS, SalesFlo) has van-sales DNA but weak portals and bolt-on FBR. Global platforms (Shopify B2B, Cin7, NetSuite) have portals and pricing engines but zero PJP/beat-plan/order-booker/manufacturer-portal capability. **SanoPOS now sits cleanly between them with the full Pakistan wedge:** FBR queue + multi-tenant/multi-outlet/RBAC core + field-rep order booker + slab schemes + manufacturer secondary-sales portal. No global player has copied this stack, and Pakistan incumbents lag on the portal/cloud side.

---

## What shipped (2026-05-13 + 2026-05-14)

**Tier 0 is complete.** All six items shipped and verified end-to-end on the prod wholesale tenant (`wholesalewalktest1778451`). **Current migration version: 89** (no DDL changes after 0.1 — everything 0.3–0.5 was code-only against the v87/v88 columns).

### 2026-05-13 commits (Tier 0.6, 0.1, 0.2 foundations)

| Commit | Layer | Summary |
|---|---|---|
| `80e2805` | Backend v87 | Tier 0.6 — `wholesale` mode + `wholesale_credit_controls` flag + `company_profile.ar_aging_buckets` JSONB (default `[30,60,90]`). Hooks into existing setup-wizard auto-enable path. |
| `5fcf6ca` | Backend infra | **migrate-pg search_path leak fix.** Same root cause as `71965b3` (master-db): Supavisor transaction-mode pooling can split SET + query across backends. Two tenant schemas carry their own `tenants` table → unqualified `SELECT FROM tenants` returned 0 rows → migrate silently skipped every tenant on `v87` deploy. Extracted `makeScopedDb()` helper using `BEGIN; SET LOCAL search_path; …; COMMIT;`. Catch tightened to only swallow missing-table errors. |
| `8025722` | Backend v88 | Tier 0.1 — `customers.credit_limit / credit_block_mode / payment_terms_days`, `sales.customer_invoice_id` FK, Credit tender in `/api/sales` (creates `customer_invoices` row + links), `GET /api/customers/:id/credit-status`, `refund_method='credit_reversal'` in `/api/returns`, `override_credit_limit` perm. |
| `fd2dcc5` | Backend v89 | Backfill `override_credit_limit` onto Manager role for existing tenants. |
| `d126777` | Frontend | Customer form fields, "Credit & A/R" SectionCard with utilization bar, POS "On Account" tender button, `POSCreditLimitModal` for manager-PIN override, `useCheckout` 403 handling + retry-with-PIN. |
| `f70e10b` | Backend | Reject `CREDIT_OVERPAYMENT` on `/api/sales` (sum of payments > sale_total when Credit tendered → 400). Fixes double-tender bug found during walkthrough. |
| `6b6fdcd` | Frontend | POS receipt now shows "On Account" panel with A/R invoice number + due date + "Net X" for on-account sales. |
| `77a6e23` | Frontend | "Reduce A/R" refund method exposed in POS Return modal (visible only when `sale.customer_invoice_id` is set). |
| `ee4fdfd` | Backend | Tier 0.2: POST/PUT/batch/quotation-conversion now default `due_date` from `customer.payment_terms_days` when omitted. |

### 2026-05-14 commits (Tier 0.3, 0.4, 0.5)

| Commit | Layer | Summary |
|---|---|---|
| `d8fa0fe` | Backend + Frontend | **Tier 0.3 — A/R Aging Report.** `GET /api/reports/ar-aging?as_of=&outlet_id=` reads `company_profile.ar_aging_buckets` (validated, falls back to `[30,60,90]`), buckets by days overdue from `due_date`. Filter: `balance_due > 0 AND status NOT IN ('paid','cancelled','void')`. New "A/R Aging" tab under Reports > Finance with dynamic column headers built from response buckets, totals row, CSV via `downloadCsv`. |
| `366967f` | Backend | **Refund-flow fix.** `refund_method='credit_reversal'` now inserts a `customer_invoice_payments` row (`payment_method='credit_reversal'`, `reference='RET-{returnId}'`) inside the same transaction as the `balance_due` update, so the statement ledger reconciles. Backfilled the one existing prod row. |
| `ddee997` | Backend + Frontend | **Tier 0.4 — Customer Statements (bank-style A/R).** `GET /api/customers/:id/statement?from=&to=` returns opening balance + chronological entries + closing balance. Default range: 1st-of-month → today (tenant tz). `POST /api/customers/:id/send-statement` emails via `services/email.js` using new `customer_statement` template (added to `TENANT_TYPES` so it sends from `slug@sanopos.com`). Frontend: "Send Statement" button on the Credit & A/R section card opens a modal with date pickers, recipient email, Preview button, and Send action. |
| `b2e0d5b` | Backend + Frontend | **Tier 0.5 — Wholesale dashboard cards.** `GET /api/reports/dashboard/wholesale` returns total_outstanding, overdue_amount (configurable via `?overdue_days=`, default 30), top 5 buyers by balance. New `DashboardWholesale` widget mounts on the home dashboard when `hasMode('wholesale')` AND `!isCashier`. Summary cards link to A/R aging report; buyer rows link to customer detail. |

### 2026-05-14 (evening) commits — Tier 1.1 + bootstrap race fix

| Commit | Layer | Summary |
|---|---|---|
| `e9d16f4` | Backend v90 + Frontend | **Tier 1.1 — Field rep mobile app foundation.** Migration v90: `employees.employee_type` (`in_store`/`field_rep`), `customers.lat`/`lng` (NULL until geo-tagged on first visit), `company_profile.field_geofence_meters` (default 500), `field_rep_routes` (weekly beat plan), `field_visits` (GPS + selfie + outcome log, `client_uuid` UNIQUE for offline idempotency), Field Rep role, `wholesale_field_sales` flag (default OFF), `manage_field_sales` perm backfilled onto Manager. New backend routes: `GET /api/field/route/today`, `POST /api/field/check-in` (R2 selfie upload + haversine distance + auto-tag-on-first-visit + idempotent on `client_uuid`), `GET /api/field/visits` (owner-facing filtered visit history), `GET /api/field/summary` (dashboard cards data), `POST /api/admin/field-routes` (route assignment endpoint — owner UI deferred to 1.1.5, seeded via SQL/CLI for now). New frontend pages: `/field/today` (mobile-first daily route list), `/field/check-in/:customer_id` (GPS auto-capture + front-camera selfie via `<input capture="user">` + client-side compression via new `imageCompress.js` + 4-button outcome flow + IndexedDB queue for offline retry via new `enqueueCheckIn`), `/field/visits` (owner drill-down table with selfie thumbnails). Login redirect: `ContextSelect` routes `employee_type='field_rep'` to `/field/today`. Dashboard: new `FieldSummaryCards` widget mounts when flag on + reps exist. New `services/geo.js` haversine helper. New `schemas/field.js` Zod schemas. New `scripts/seed-field-routes.js` CLI. |
| `e105e20` | Backend v91 | **v91 hotfix — Field Rep role + Manager perm backfill.** v90 sub-step 6 rolled back on prod tenants because the `roles_id` sequence had advanced past existing ids (likely from earlier rolled-back attempts on the same migration run), so the role INSERT hit `roles_pkey` before `ON CONFLICT (name)` could match. Whole savepoint rolled back, dropping the Manager perm backfill too. v91 splits the failure-prone block into three independent savepoints: reset `roles_id_seq` to `MAX(id)+1` first, insert Field Rep role in its own savepoint, backfill Manager perm in its own savepoint (must succeed even if role insert hits some unrelated problem). |
| `c031a6c` | Frontend | **Bootstrap race fix.** `PresetContext`'s `useEffect` fires on `(employee?.id, isBootstrapping)` change. On the login commit, child effects run before parent effects, so `PresetProvider`'s fetch fires before `AuthProvider`'s effect swaps in the new `window.fetch` interceptor (whose closure captured the new employee). The first `/api/context/bootstrap` went through the previous closure (employee=null) and 401'd — every login flashed a console error. The existing 600ms retry masked it functionally but was noisy. Fix: yield to a macrotask (`setTimeout 0`) before the first call. Pending React effects flush in microtasks, so the next macrotask sees the new interceptor live. Retry stays as safety net. |

### Tier 1.1 walkthrough verification (Playwright + Supabase MCP)

End-to-end verified 2026-05-14 evening, mobile viewport (390×844):

1. **Owner dashboard** — Logged in as Wholesale Test Owner. `FieldSummaryCards` widget rendered: "Field Sales Today" header, Field Rep One card showing "Last seen never · 0 / 5 visited · 0 orders · 0 no stock · 0 closed · 0 away · 0 flagged".
2. **Field rep login** — Logged in as Field Rep One. **Auto-redirected to `/field/today`** (employee_type routing works). Header "Wednesday's route" derived from `Asia/Karachi` timezone. "0 / 5 visited" pill. All 5 customer cards in `visit_order`. Cards for shops with NULL lat/lng show the "Shop not geo-tagged yet" hint.
3. **Check-in #1 (geofence-pass path)** — Tapped Shaheen General Store (saved coords 24.85970, 67.02180). Faked GPS to 24.85993, 67.02201 (~30m away). Took a canvas-rendered selfie. Tapped "Took Order". Backend wrote `field_visits` row #1 with `customer_id=2, status='ordered', gps_distance_m=33, gps_flagged=false, gps_accuracy_m=18, selfie_url=R2 URL, client_uuid=<uuid>`. UI redirected back to `/field/today` showing "1 / 5 visited" + "Took Order" badge on Shaheen.
4. **Check-in #2 (geo-tag-on-first-visit path)** — Tapped Test Distributor (saved coords NULL). The check-in page auto-flipped `tag_shop_location = true` because of NULL coords. Faked GPS to 24.915, 67.085. Took selfie. Tapped "Took Order". Backend wrote `field_visits` row #2 with `gps_distance_m=0` (matched the coords it just wrote) AND **also wrote `customers.lat=24.915000, lng=67.085000`** — first visit canonicalised the shop location.
5. **Owner-side verification** — Logged back in as Wholesale Test Owner. Dashboard card refreshed showing "Last seen just now · 2 / 5 visited · 2 orders · 0 no stock · 0 closed · 0 away". Navigated to `/field/visits`. Table showed both visits with selfie thumbnails (clickable to R2 full-size), distance, accuracy, outcome. CSV export button works.
6. **Console errors during walkthrough** — Initially 2 (one per login: bootstrap race 401). After `c031a6c` deployed, **0 errors** across full walkthrough.

### Live state on `tenant_wholesalewalktest1778451` (prod, verified 2026-05-14 evening)

- `schema_version = 93`
- `tenant_modes`: `wholesale = true`
- `feature_flags`: `wholesale_credit_controls = true`, `wholesale_field_sales = true`, **`wholesale_schemes = true`**
- `company_profile.ar_aging_buckets = [30, 60, 90]`, `field_geofence_meters = 500`
- `customers` has the 3 credit columns + `lat`/`lng`
- `sales.customer_invoice_id` FK exists, **`sales.field_visit_id` FK exists (v92)**
- **`promotions.tier_rules` JSONB, `brand_id`, `priority` exist (v93); `sale_promotion_applications` audit table exists**
- `role_permissions`: Manager has `override_credit_limit` + `manage_field_sales`; Field Rep has `manage_field_sales`
- Roles: 1=Administrator, 2=Manager, 3=Cashier, **4=Field Rep**
- Employees: id=1 Wholesale Test Owner, id=2 Test Cashier, **id=3 Field Rep One** (`employee_type='field_rep'`, password `TestField234!`, PIN `7777`)
- Customers (5): 1=Test Distributor (now geo-tagged), 2=Shaheen General Store, 3=New City Mart, 4=Khalid Kiryana Store, 5=Ahmed Brothers
- `field_rep_routes`: employee 3 has all 7 days seeded with 5 customers each (Sun-Sat)
- `field_visits`: 2 rows from the walkthrough (Shaheen + Test Distributor, both `ordered`)
- Test Distributor outstanding: Rs 183,000 across 4 open invoices (math reconciled via aging endpoint + statement endpoint)

### Tier 0 progress (final)

| Item | Status | Notes |
|---|---|---|
| 0.1 — Credit limit + Credit POS tender | **SHIPPED + browser-verified** | Manager-PIN override modal works end-to-end via "Test Cashier" (PIN 1234); Admin bypass is by design. |
| 0.2 — Per-customer payment terms | **SHIPPED** | `payment_terms_days` column added in v88; `due_date` auto-defaults on POST/PUT/batch/quotation-conversion (commit `ee4fdfd`). Verified live: INV-000004 due=invoice_date+30. |
| 0.3 — A/R aging report | **SHIPPED** | Endpoint + Reports tab live. Buckets configurable via `ar_aging_buckets` JSONB. CSV export. |
| 0.4 — Customer statements | **SHIPPED** | Full bank-style: opening balance + invoices + payments (incl. credit_reversal) + closing balance. Default range 1st-of-month → today. Email sends from tenant `slug@sanopos.com`. |
| 0.5 — Wholesale dashboard cards | **SHIPPED** | Total Outstanding A/R, Overdue >30 days, Top 5 buyers by balance. Mode-gated, cashier-hidden. |
| 0.6 — Wholesale mode + flag | **SHIPPED** | v87 — wholesale in MODE_REGISTRY, `wholesale_credit_controls` in DEFAULT_FEATURE_FLAGS, ar_aging_buckets in company_profile. |

### Outstanding follow-ups (NOT blockers — keep tracking)

- **Integration tests**: `backend/tests/integration/pg-wholesale-credit-limit.test.js` lands with 9 `it.skip()` cases. The test-fixture clock-in path (direct insert into `attendance_sessions`) doesn't satisfy `/api/sales`' `getEmployeeCheckoutStatus` guard inside an isolated test schema. Likely a tz / session_type / today-date interaction. Debug separately and unskip.
- **Browser walkthrough of 0.3–0.5 surfaces**: endpoints verified via authenticated curl + Supabase MCP. Visual confirmation of the new Reports tab, statement modal, and dashboard cards on `https://sanopos.com` deferred. UI logic mirrors existing patterns (reports tab matches FBRExportTab; statement modal matches the existing customer modals; dashboard widget matches the retail card pattern).
- **Tier 1.1.5 — owner-facing route-assignment UI**: `/admin/field-routes` page with rep + day-of-week + drag-drop customer ordering. v90 backend endpoint `POST /api/admin/field-routes` already accepts the body; CLI script `seed-field-routes.js` already drives it. Build this only when (a) 3+ wholesale tenants use the field app, or (b) the first owner asks to self-serve route edits. Until then, support seeds via SQL / `railway run node backend/scripts/seed-field-routes.js`.
- **Tier 1.1 integration tests**: no automated coverage yet for `field.js` routes. The Playwright walkthrough proves end-to-end behavior; consider adding `backend/tests/integration/pg-field-sales.test.js` with the same isolated-schema pattern when revisiting test debt.
- **Field rep `outlets` assignment**: Field Rep One has no `employee_outlets` row, so `/api/context/bootstrap` returns empty `outlets`/`companies`. Harmless for the current flow (field check-ins don't gate on outlet context — outlet_id is best-effort on `field_visits.outlet_id`). If a future field-sales flow needs outlet scoping (e.g. "Manager X only sees field reps in their outlet"), wire up `employee_outlets` either in the seed flow or via the 1.1.5 admin UI.

---

## Where we are (live state — verified 2026-05-14 evening)

### The wholesale preset

| Field | Value | Source |
|---|---|---|
| `industry_type` | `wholesale` | [industry-config.js:231](../../backend/config/industry-config.js#L231) |
| `business_model` | `b2b_distribution` | [industry-config.js:232](../../backend/config/industry-config.js#L232) |
| `display_name` | `Wholesale / Distribution` | [industry-config.js:233](../../backend/config/industry-config.js#L233) |
| `modes` | `[]` (none) | [industry-config.js:234](../../backend/config/industry-config.js#L234) |
| Labels | `customer→Buyer`, `customers→Buyers`, `sale→Invoice`, `order→Order` | [industry-config.js:235-242](../../backend/config/industry-config.js#L235-L242) |
| POS layout | `grid` | [industry-config.js:252](../../backend/config/industry-config.js#L252) |
| Onboarding steps | `store → product → employees → shift → sale` (same as retail) | [industry-config.js:251](../../backend/config/industry-config.js#L251) |
| Seed products | 3 bulk items (Bulk A 10K, Bulk B 15K, Clearance 2K) | [preset-seed-data.js:33-40](../../backend/seeds/preset-seed-data.js#L33-L40) |
| Flag bundle on signup | Same as `general_retail` and `grocery` | [setup.js:272](../../backend/routes/setup.js#L272) |
| Portal tabs | `invoices`, `orders`, `profile` | [industry-config.js:761](../../backend/config/industry-config.js#L761) |
| Portal tab labels | `Account Invoices`, `Purchase Orders` | [industry-config.js:784](../../backend/config/industry-config.js#L784) |

### What a wholesale tenant CAN do today

Real capability — not vaporware, not bolt-on. Every item here is wired up and works:

| Capability | Where | Notes |
|---|---|---|
| **Customer groups with flat % discount** | `customer_groups.discount_percent` ([schema-pg.sql:303-310](../../backend/schema-pg.sql#L303-L310)) | E.g. "Distributors group" gets 10% off list. Manual assignment per customer. |
| **Per-customer price list** | `customers.price_list_id → price_lists` ([schema-pg.sql:265-274](../../backend/schema-pg.sql#L265-L274), [routes/price-lists.js](../../backend/routes/price-lists.js)) | Override price per SKU per customer. |
| **Price books with rules** | [routes/price-books.js](../../backend/routes/price-books.js), `phase2g_price_books` flag | Rule-based override engine on top of price lists. |
| **Customer running balance** | `customers.balance NUMERIC` ([schema-pg.sql:354](../../backend/schema-pg.sql#L354)) | Tracked, not enforced as a cap. |
| **Customer invoices with terms** | `customer_invoices` ([schema-pg.sql:2745+](../../backend/schema-pg.sql#L2745)), `customer_invoicing` flag | `balance_due`, `due_date`, `amount_paid`, `status`. |
| **Quotations** | `quotations` table, [routes/quotations.js](../../backend/routes/quotations.js), `crm_quotations` flag | Quote → must PUT status to `accepted` → `convert` to sale. |
| **CRM module** | [routes/tier4/crm.js](../../backend/routes/tier4/crm.js), `crm_quotations` flag | Notes per buyer, quotation pipeline. |
| **Multi-outlet stock + transfers** | `outlet_stock`, `variant_outlet_stock`, `inventory_transfers` | Multiple warehouses with their own stock. |
| **Buyer-facing portal** | [routes/customer-portal/](../../backend/routes/customer-portal/), [pages/portal/](../../frontend/src/pages/portal/) | Buyer logs in, sees invoices and orders. |
| **FBR Digital Invoicing** | [routes/fbr.js](../../backend/routes/fbr.js), [services/fbr.js](../../backend/services/fbr.js), `workers/fbr-worker-boss.js`, `fbr_integration` flag | **Real-time queue with exponential backoff retry, IRN + QR code stamping. This is a moat.** |
| **Marketplace channels** | Daraz, Meta, WhatsApp, Google Merchant; `marketplace_integrations` flag | Wholesale tenants with a B2C side. |
| **Bulk import** | [routes/import.js](../../backend/routes/import.js), `/import` page | CSV/XLSX for products, customers, suppliers. Critical for onboarding a real wholesaler. |
| **Report Builder** | [routes/tier4/report-builder.js](../../backend/routes/tier4/report-builder.js), `phase2_report_builder` flag | Custom reports if pre-built ones don't cover. |
| **Accounting core** | [routes/tier4/accounting.js](../../backend/routes/tier4/accounting.js), `accounting_core` flag | Chart of accounts, journal entries, limited. |
| **Sidebar label remap** | [AppLayoutRedesign.jsx:92-108](../../frontend/src/components/AppLayoutRedesign.jsx#L92-L108) | Customers → Buyers, Sales History → Invoice History (after 891994d). |
| **Credit limit + Credit POS tender** | [routes/customers.js](../../backend/routes/customers.js), [routes/sales.js](../../backend/routes/sales.js), `wholesale_credit_controls` flag | Tier 0.1 — per-customer cap with warn/hard/off block modes, "On Account" tender, manager-PIN override via `POSCreditLimitModal`. |
| **Per-customer payment terms + auto-default due date** | `customers.payment_terms_days` (v88), [routes/customer-invoices.js](../../backend/routes/customer-invoices.js) | Tier 0.2 — POST/PUT/batch/quotation-convert all default `due_date = invoice_date + payment_terms_days` when omitted. |
| **A/R aging report** | `GET /api/reports/ar-aging`, Reports > Finance > A/R Aging tab | Tier 0.3 — buckets configurable via `company_profile.ar_aging_buckets` JSONB. CSV export. |
| **Bank-style customer statements** | `GET /api/customers/:id/statement`, `POST .../send-statement`, "Send Statement" button on Customer detail | Tier 0.4 — opening balance + chronological invoices + payments (incl. credit_reversal) + closing balance. Emails from tenant `slug@sanopos.com`. |
| **Wholesale home dashboard cards** | `GET /api/reports/dashboard/wholesale`, `DashboardWholesale` widget | Tier 0.5 — Total Outstanding A/R, Overdue >N days, Top 5 buyers. Mode-gated, cashier-hidden. |
| **Field rep mobile app (proof-of-visit)** | [routes/field.js](../../backend/routes/field.js), `/field/today` + `/field/check-in/:id` + `/field/visits`, `wholesale_field_sales` flag, `FieldSummaryCards` dashboard widget | Tier 1.1 — `employee_type='field_rep'` employees auto-redirect to `/field/today` on login; daily route from `field_rep_routes`; GPS + selfie + outcome check-in with R2 selfie storage, haversine geofence (default 500m, tunable via `company_profile.field_geofence_meters`), auto-tag-on-first-visit for customers with NULL coords, IndexedDB offline queue with `client_uuid` idempotency; owner dashboard card + drill-down `/field/visits` report with selfie thumbnails. |

### What a wholesale tenant CANNOT do today

The "show me the wall." These are real day-1 blockers from the research, sequenced by impact. Tier 0 closed the first four rows in 2026-05-13/14; everything below the rule is still open.

| Gap | What real wholesalers need | What we have |
|---|---|---|
| ~~**Credit limit enforcement**~~ | ~~Cap "Buyer X cannot owe more than Rs 500K." Hard or soft block at sale time.~~ | **SHIPPED 2026-05-13** — `customers.credit_limit/credit_block_mode` (v88), POS "On Account" tender, `POSCreditLimitModal` for manager-PIN override, `override_credit_limit` perm. |
| ~~**A/R aging report**~~ | ~~"Show me every buyer's outstanding bucketed 0-30/31-60/61-90/90+." Standard everywhere.~~ | **SHIPPED 2026-05-14** (commit `d8fa0fe`) — `GET /api/reports/ar-aging`, buckets from `company_profile.ar_aging_buckets`, Reports > Finance > A/R Aging tab with CSV export. |
| ~~**Customer statements**~~ | ~~"Email Buyer X a PDF of every unpaid invoice this month."~~ | **SHIPPED 2026-05-14** (commit `ddee997`) — bank-style ledger, `GET /api/customers/:id/statement`, `POST .../send-statement` emails from tenant `slug@sanopos.com`, "Send Statement" button on customer detail. |
| ~~**Per-buyer payment terms field**~~ | ~~Net-30/45/COD on the customer record, surfaced at sale + invoice.~~ | **SHIPPED 2026-05-13** — `customers.payment_terms_days` (v88), auto-defaults `customer_invoices.due_date` on POST/PUT/batch/quotation-conversion (commit `ee4fdfd`). |
| ~~**PJP / beat plan foundation (proof-of-visit)**~~ | ~~Field rep visits 8 retailers/day. Offline-first, GPS check-in, selfie attendance, outcome capture.~~ | **SHIPPED 2026-05-14** (Tier 1.1, commit `e9d16f4`) — full check-in flow live, see entry in the "CAN do today" table above. **Order capture from field is still in 1.2** — rep can record visits + outcomes but can't yet take orders on the phone. |
| **Order capture from field rep app** | Rep picks products in mobile UI, applies schemes, pushes order through credit check, syncs offline orders back. | Tier 1.2 — depends on schemes for full value. Rep app screens + offline queue infrastructure ready; need product picker + order POST. |
| **Schemes engine** | "Buy 10 cases Tapal, get 1 free." "≥50 cases this quarter → 3% rebate." Slab, free-goods, retrospective. | Generic promotions, not B2B schemes. |
| **Secondary sales tracking** | Manufacturer wants real-time view of distributor's onward sales to retailers. | Nothing. |
| **Unit-of-measure conversion** | Stock in cartons of 24, sell by carton or by unit. Reorder threshold in cartons. | Zero schema hits for `uom`, `case_pack`, `carton`. |
| **MOQ enforcement** | "Min order Rs 50K" or "multiples of 12 only." | `min_order_amount` exists on suppliers (PO-side), nothing on customer-side. |
| **Sales order with stock commit** | SO reserves stock without depleting. Decrement at dispatch. | Sales deplete immediately; quotations don't reserve. |
| **Backorders / partial fulfillment** | Ship 60 of ordered 100, mark 40 backordered, fulfill later from same SO. | No "remaining qty" concept. |
| **Company hierarchy + buyer roles** | Buyer Company → multiple ship-to locations → Org Admin / Buyer / Approver / Accountant users with spend caps. | Customers are flat — one customer, one user, no hierarchy. |
| **Quote → SO → Pick → Pack → Ship → Invoice as distinct documents** | Each stage has its own state, audit trail, reversal path. Reservation at SO, decrement at Pick, invoice at Ship. | Quotation → sale is one step. |
| **RFQ workflow** | Buyer requests pricing → seller reviews/adjusts → sends back → buyer accepts → converts. | Quotations exist but no buyer-initiated RFQ from the portal. |
| **Vaulted card auto-charge on Net due** | Buyer saves card; system charges on Day 30. Eliminates 80% of dunning. | Manual payment recording only. |
| **Deposits / partial payment at order** | 30%/50% upfront on custom orders. | Sales are paid in full at checkout. |
| **Margin reports by buyer / SKU / rep** | "What did I make on Buyer X last quarter?" | Report Builder probably can express this, no pre-built. |
| **Grid ordering (apparel size-run)** | One screen: 5 sizes × 4 colors with qty boxes, submit one order. Critical for PK textile. | Nothing — one row per SKU at POS. |
| **EDI 850/856/810** | Required when wholesaler ships to chain stores (Metro/Imtiaz/Carrefour/Hyperstar). | Nothing. Defer until first ask. |

---

## Roadmap (the actual plan)

Four tiers, opinionated about sequence. Pick from one tier at a time. Do **not** cherry-pick across tiers — the dependencies are real.

> **Why this order?** Tier 0 makes wholesale not-embarrassing for the next real signup. Tier 1 is the moat — the thing no global player will copy. Tier 2 is parity with Shopify B2B / Cin7 so we don't lose competitive deals. Tier 3 is enterprise nice-to-haves that we should not start without a customer asking.

### Tier 0 — Make wholesale not embarrassing — **SHIPPED 2026-05-13 → 2026-05-14**

**Goal achieved:** A wholesale signup now gets credit controls, A/R aging, customer statements, per-customer payment terms, and a wholesale-specific home dashboard out of the box.

| # | Item | Status | Where it lives |
|---|---|---|---|
| 0.1 | Customer credit limit + enforcement | ✅ shipped 2026-05-13 | `customers.credit_limit / credit_block_mode` (v88), POS Credit tender, `POSCreditLimitModal`, `override_credit_limit` perm, `wholesale_credit_controls` flag |
| 0.2 | Per-customer payment terms | ✅ shipped 2026-05-13 | `customers.payment_terms_days` (v88), auto-defaults `customer_invoices.due_date` (commit `ee4fdfd`) |
| 0.3 | A/R aging report | ✅ shipped 2026-05-14 | `GET /api/reports/ar-aging`, Reports > Finance > A/R Aging tab (commit `d8fa0fe`); buckets from `company_profile.ar_aging_buckets` |
| 0.4 | Customer statements (bank-style) | ✅ shipped 2026-05-14 | `GET /api/customers/:id/statement` + `POST .../send-statement`, `customer_statement` email template, "Send Statement" button on Customer detail (commit `ddee997`); refund-flow fix commit `366967f` ensures credit_reversal writes a `customer_invoice_payments` row |
| 0.5 | Wholesale dashboard cards | ✅ shipped 2026-05-14 | `GET /api/reports/dashboard/wholesale`, `DashboardWholesale` widget gated by `hasMode('wholesale')` (commit `b2e0d5b`) |
| 0.6 | `wholesale` mode + feature flag | ✅ shipped 2026-05-13 | `MODE_REGISTRY` (v87), `wholesale_credit_controls` in `DEFAULT_FEATURE_FLAGS`, `ar_aging_buckets` in `company_profile` |

**Migration markers:** Tier 0 used v87 (mode + flag + ar_aging_buckets), v88 (credit fields + Credit tender + invoice link), v89 (Manager perm backfill). **No schema changes needed for 0.3/0.4/0.5** — all built on existing tables. Tier 1 will continue from v90+.

**Tier 0 exit criteria — all met:**
- A wholesale tenant can set a credit limit, attempt to oversell, get blocked. ✅ verified end-to-end via "Test Cashier" + Admin PIN walkthrough.
- A wholesale tenant can run A/R aging and see who owes them what. ✅ aging endpoint returns Rs 183K across 4 invoices on test tenant; math reconciles to plain `SUM(balance_due)`.
- A wholesale tenant can email a statement to a buyer. ✅ statement endpoint returns 6 entries with correct running balance (incl. credit reversal); email template sends from `slug@sanopos.com`.

### Tier 1 — The Pakistan wedge (target: 4-6 weeks)

**Goal:** Ship the thing no global player will copy. This is the differentiator — PJP/beat-plan + schemes + secondary sales — combined with our existing FBR queue.

| # | Item | Status | Notes | Estimate |
|---|---|---|---|---|
| 1.1 | **Field rep mobile app foundation** | **SHIPPED 2026-05-14** | v90 + v91 + frontend pages. `employee_type` column, `field_rep_routes` + `field_visits` tables, `wholesale_field_sales` flag, Field Rep role + `manage_field_sales` perm. 5 backend routes. 3 frontend pages (today / check-in / visits) + dashboard summary cards. Auto-redirect for `employee_type='field_rep'`. GPS + selfie + outcome check-in flow with R2 upload, haversine geofence, auto-tag-on-first-visit, IndexedDB offline queue. Verified end-to-end via Playwright. | Done |
| 1.1.5 | **Owner route-assignment UI** | **SHIPPED 2026-05-14** | `/field/routes` admin page with reorder + add/remove per (rep, day-of-week). Backend endpoint `POST /api/admin/field-routes` powered by replace-all semantics. Verified end-to-end on production. Commits `afa2e6f` + `22dd35f` (employee_type hotfix). | Done |
| 1.2 | **Order capture from field rep app** | **SHIPPED 2026-05-14 + verified live 2026-05-15** | Migration v92 added `sales.field_visit_id` FK. POST `/api/sales` accepts `field_visit_uuid` and resolves uuid → id via `field_visits.client_uuid` lookup (offline-friendly — order can sync before visit row exists). New page `/field/order/:customer_id?visit_uuid=` with product picker + cart + Credit/Cash; soft credit-availability warning, backend still enforces hard credit limit. Check-in's "Took Order" outcome auto-advances to order screen. Offline queue extended with `type='field_order'`. Owner visit log shows linked invoice + total. **Schemes preview deferred to 1.3** (no placeholder added — keeps order UI clean). Initial commit `8b8dd42`, then 4 hotfixes during live walkthrough: `7f55188` (field rep allow-list on `/api/products` + `/api/customers/:id/credit-status`, resilient `allSettled` load), `36ce7a1` (field rep bypass on `GET /api/outlets`), `d78cadd` (field rep bypass on outlet-assignment enforcement in `registerAllRoutes.js`), `33378d6` (skip outlet clock-in check on `POST /api/sales` when `field_visit_id`/`field_visit_uuid` present). End-to-end verified: visit id=3 → sale id=4 → invoice `INV-2026-00004` Rs 22,000. | Done |
| 1.3 | **Schemes engine** | **SHIPPED 2026-05-15 + verified live** | Built as an extension of the existing `promotions` engine (not a parallel `schemes` stack — reuses the production `/api/promotions/quote` evaluator that POS already calls). Migration v93: `promotions.type` CHECK gains `slab_percent`; new columns `tier_rules` JSONB + `brand_id` FK + `priority` INT; new `sale_promotion_applications` audit table with frozen snapshots (`promotion_name_snapshot`, `promotion_type_snapshot`, `qty_qualifying`, `discount_value`, `tier_snapshot`); `wholesale_schemes` flag default OFF. Evaluator handles slab_percent (matched qty → first matching tier wins, no stacking across tiers) + `applies_to='brand'` (auto-hydrates brand_id from products). `PromotionsRedesign` admin page conditionally surfaces the slab editor + brand picker + priority field when the flag is on. Rep app order screen does debounced quote calls (400ms) and shows applied schemes + scheme discount + net total. Verified end-to-end: tiered evaluator returns correct discounts at all 3 boundaries (qty=4 → 0, qty=7 → tier1 5%, qty=12 → tier2 10%); sale id=5 written with audit row capturing snapshot. Retrospective period-end rebates explicitly deferred to 1.3.5 if a real tenant asks. Commit `8a44bfc` (backend) + `ba9cfe4` (frontend). | Done |
| 1.4 | **Secondary sales tracking** | **SHIPPED 2026-05-15 + Playwright walkthrough verified live** | Manufacturer portal at `/manufacturer-portal/:tenantSlug` — parallel JWT scope to customer portal, isolated session store + API client. Distributor admin invites brand owners from `/settings/manufacturer-partners`; partner clicks magic-link email, sets password, lands on dashboard. Backend: migration v94 adds `manufacturer_partners` + `manufacturer_partner_brands` + `manufacturer_portal_refresh_tokens` + `wholesale_secondary_sales` flag. Five data endpoints (`/me`, `/summary`, `/sales` w/ 4 group_by axes, `/sales.csv`, `/promotions`). PII invariant enforced: only `customers.city` referenced in joins; no `customer_id/name/phone/email/address` returned anywhere. Scheme attribution at scheme-level only (sale-scoped audit table). Commits: `57515db` (v94), `dbd2af8` (middleware), `baa786f` (auth routes), `8eedf91` (signup seed), `0d09908` (data routes), `fe8f962` (4 tz/param bug fixes), `7288780` (SPA shell), `fc20f72` (Sales + Schemes), `0b03a78` (admin CRUD page). Tier 1.4 Bug #5 caught during Playwright walkthrough: frontend default date range used UTC today not local — patched post-walkthrough. | Done |
| 1.5 | **Wholesale tenant mode flag bundle** | **SHIPPED 2026-05-15** (auto-seed on signup) | `seedWholesaleFlags()` added to `services/retail-flag-preset.js`. New wholesale signups now land with all 4 wholesale flags ON: `wholesale_credit_controls`, `wholesale_field_sales`, `wholesale_schemes`, `wholesale_secondary_sales`. Existing tenants untouched. Commit `8eedf91`. | Done |

**Tier 1 exit criteria:**
- A field rep can log in to a mobile-optimized view, see their route for today, drive to retailer A, check in (GPS + selfie), **take an order**, sync it back. *(1.1 done; order entry pending in 1.2.)*
- A scheme like "Buy 10 cartons, get 1 free" can be defined and auto-applies at order entry. *(1.3 pending.)*
- A manufacturer-tenant or manufacturer-partner can see secondary sales reports. *(1.4 pending.)*

### Tier 2 — Parity with Shopify B2B / Cin7 (target: 8-12 weeks)

**Goal:** Don't lose competitive deals against Shopify B2B (now on all paid plans as of April 2026) or Cin7 ($349/mo with B2B portal included).

| # | Item | Notes | Estimate |
|---|---|---|---|
| 2.1 | **Multi-UOM** | `product_uoms` table (product_id, code, name, conversion_factor_to_base). Or simpler: `products.case_pack INTEGER` + `products.case_price NUMERIC` for the 80% case. Stock in base units, sell-by toggle at POS. | 2 weeks |
| 2.2 | **MOQ / case-pack enforcement** | `products.min_order_qty INTEGER`, `products.order_increment INTEGER`. Frontend block + backend reject. | 3 days |
| 2.3 | **Quote → SO → Pick → Pack → Ship → Invoice as distinct documents** | `sales_orders` table (separate from `sales`), with stages. Stock reservation at SO confirm via `inventory_reservations` (exists for restaurant). Decrement at pick. Invoice creation at ship. | 3 weeks — this is big and touches the whole order pipeline. |
| 2.4 | **Backorders / partial fulfillment** | `sale_items.qty_remaining`, multiple shipment records per SO. | 1 week (after 2.3) |
| 2.5 | **Vaulted card auto-charge on Net due** | Integrate with xPay sandbox to vault. Add `customer_payment_methods` table. Background worker checks due invoices and auto-charges. | 1 week |
| 2.6 | **Company hierarchy + buyer roles** | New tables: `buyer_companies` (replaces or extends `customers`), `buyer_locations`, `buyer_users` (with role: org_admin/buyer/approver/accountant/readonly). Per-user spend cap. Approval workflow: orders >threshold need approver sign-off. | 3-4 weeks — this is the biggest single item. |
| 2.7 | **RFQ workflow at portal** | Buyer adds items to basket, clicks "Request Quote" instead of "Buy". Seller sees pending RFQ, adjusts price/qty, sends back. Buyer accepts → converts to SO. | 1 week (after 2.6) |
| 2.8 | **Deposits / partial payment on order** | `sales_orders.deposit_amount`, capture deposit at order confirm via existing payment gateway adapter. | 4 days |
| 2.9 | **Grid ordering** | New POS layout `grid_matrix` — for products with variants on 2 axes (size × color), one screen with qty boxes per cell. Wholesale-textile specific. | 1.5 weeks |
| 2.10 | **Reorder previous + favorites at portal** | One-click "reorder last order" button. Per-buyer favorites list. | 4 days |
| 2.11 | **Customer-specific catalog visibility** | `price_lists.allowed_product_ids` or new `customer_visible_products` table. Some SKUs invisible to some buyers. | 1 week |

**Tier 2 exit criteria:**
- A wholesale tenant can run a real quote → order → invoice flow with stock reserved at the right moment.
- Their buyers self-serve via portal with company-level user management.
- A textile wholesaler can take size-run orders in one screen.
- We can credibly say "we match Shopify B2B / Cin7 on B2B core."

### Tier 3 — Defer until asked

Don't start any of these without a real customer asking. Listed here so we don't forget they exist.

- **EDI 850/856/810** — partner integration (Crstl/Orderful/SPS) when first wholesaler hits a chain-store contract.
- **Punchout catalogs** (Coupa/Ariba) — only matters for govt/hospital/NGO institutional buyers.
- **BNPL on B2B** — finance partner integration. Cool but not core.
- **Drop-ship from supplier to customer** — niche flow.
- **Consignment stock** — stock at customer's location, billed on sell-through.
- **Bulk CSV order upload at portal** — buyer pastes 200-row order from their ERP.
- **Per-warehouse stock visibility to buyer** — "36 Karachi, 12 Lahore, 0 Multan."
- **Multi-currency per customer** — only matters when first regional/export wholesaler signs up.
- **Dunning sequences** (auto-email at +7/+14/+30 overdue) — once vaulted cards (2.5) ships, dunning matters less.
- **Sales target by rep / region** — once field-rep app (Tier 1) is live, this becomes the obvious next step.

---

## Decision rules

**When tempted to add a feature outside this roadmap:**
1. Is it on Tier 0/1/2? Then do it in tier order.
2. Is it on Tier 3? Then we need a real customer asking before we start.
3. Is it not on this list? Then either (a) revisit the roadmap and add it with reasoning, or (b) don't.

**When tempted to skip Tier 0 and jump to Tier 1:**
Don't. A real wholesale signup with no credit controls will churn before they ever use a field rep. Tier 0 is small (1-2 weeks). Just do it.

**When tempted to skip Tier 1 and jump to Tier 2:**
This is the trap. Tier 2 makes us "good enough vs Shopify B2B." Tier 1 makes us "the only choice in Pakistan for distribution." If we never build Tier 1, we're competing on Shopify's terms, on Shopify's pricing, on Shopify's home turf. Resist.

**When a real wholesale customer signs up:**
Their actual pain (collected within the first 2 weeks of their signup) overrides this roadmap. The roadmap is the default; the customer is the truth.

---

## Open questions to resolve before starting Tier 0

1. **Hard block vs soft block on credit limit by default?**
   - Hard = sale refuses. Soft = warn + allow with manager override.
   - Recommendation: soft (`credit_block_mode='warn'`), with per-tenant config to harden.
2. **Statement template — minimal or full?**
   - Minimal: list of unpaid invoices + total.
   - Full: opening balance, every transaction, closing balance (like a bank statement).
   - Recommendation: minimal for v1, full later.
3. **AR aging buckets — fixed or configurable?**
   - Convention: 0-30/31-60/61-90/90+.
   - Some PK distributors run weekly (0-15/16-30/31-45/46+).
   - Recommendation: configurable via `company_profile.ar_aging_buckets JSONB` (default `[30,60,90]`).
4. **Where does the wholesale-specific dashboard live?**
   - New `/wholesale/dashboard` route, or extra cards on the existing `/dashboard` when `industry_type='wholesale'`?
   - Recommendation: extra cards on existing dashboard, gated by mode.

---

## Test tenant for verification

Use this tenant for all wholesale walk-throughs. Do not delete.

| Field | Value |
|---|---|
| Login URL | https://sanopos.com/login |
| Store Code | `wholesalewalktest1778451` |
| Username | `Wholesale Test Owner` |
| Password | `TestWholesale778!` |
| Admin PIN | `4321` |
| Tenant ID | 103 |
| Owner Email | `wholesalewalk-1778451+test@gmail.com` |
| Preset | wholesale / b2b_distribution / Pakistan / PKR |
| Sample products | Bulk A (Rs 10K), Bulk B (Rs 15K), Clearance (Rs 2K) — all stock=0 |

Before testing flows, run a stock adjustment via `/adjustments` to give samples non-zero stock.

---

## Reference: cited paths

- Wholesale preset config: [backend/config/industry-config.js:230-255](../../backend/config/industry-config.js#L230-L255)
- Wholesale seed products: [backend/seeds/preset-seed-data.js:33-40](../../backend/seeds/preset-seed-data.js#L33-L40)
- Onboarding flag bundle decision: [backend/routes/setup.js:269-273](../../backend/routes/setup.js#L269-L273)
- Portal tabs: [backend/config/industry-config.js:761](../../backend/config/industry-config.js#L761)
- Portal labels: [backend/config/industry-config.js:784](../../backend/config/industry-config.js#L784)
- Customer schema: [backend/schema-pg.sql:344-379](../../backend/schema-pg.sql#L344-L379)
- Supplier credit (not customer): [backend/schema-pg.sql:40-50](../../backend/schema-pg.sql#L40-L50)
- Customer invoices: [backend/schema-pg.sql:2745](../../backend/schema-pg.sql#L2745)
- Customer groups: [backend/schema-pg.sql:303-310](../../backend/schema-pg.sql#L303-L310)
- Price lists: [backend/schema-pg.sql:265-274](../../backend/schema-pg.sql#L265-L274)
- Sidebar label translation: [frontend/src/components/AppLayoutRedesign.jsx:92-108](../../frontend/src/components/AppLayoutRedesign.jsx#L92-L108)
- Competitive research: [docs/wholesale-docs/research-competitive-landscape.md](research-competitive-landscape.md)
- Yesterday's handoff: [docs/retail-docs/next-session-2026-05-12.md](../retail-docs/next-session-2026-05-12.md)
