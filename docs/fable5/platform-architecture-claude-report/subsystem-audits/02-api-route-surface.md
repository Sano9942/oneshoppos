# Subsystem Audit 02 — API Route Surface

> **RAW EVIDENCE — read with care.**
> Produced by a read-only source-code audit on **2026-07-29** at commit **`3b84732d`**.
> Findings are graded **REPORTED** unless the [main report](../01-architecture-report.md) marks them CONFIRMED.
> Where this document and the main report disagree, **the main report wins**.
> Line numbers drift: **grep the named symbol, don't trust the number.**
>
> **Note:** finding #1 below (Shopify webhook unreachable) was subsequently **CONFIRMED against live production** — see [`../02-verification-log.md` §6](../02-verification-log.md).

---

## 0. Headline numbers

| Metric | Value | How derived |
|---|---|---|
| `.js` files under `backend/routes/` | **180** | `find backend/routes -name '*.js' \| wc -l` |
| Express route registrations | **1344** | ripgrep over `backend/routes/**/*.js` |
| `app.get`/`post`/`put`/`delete`/`patch` | 491 / 445 / 150 / 83 / 3 | verb breakdown |
| `router.get`/`post`/`put`/`delete` | 76 / 61 / 29 / 6 | verb breakdown |
| `app.*` vs `router.*` | 1172 vs 172 | direct-on-app dominates |
| Files with 0 endpoints (orchestrators) | 8 | `admin.js`, `admin/index.js`, `admin/helpers.js`, `reports/index.js`, `reports/helpers.js`, `shopify/index.js`, `tier4/index.js`, `integrations/index.js` |

**Endpoints by area:**

| Area | Files | Endpoints |
|---|---|---|
| top-level `routes/*.js` | 111 | 913 |
| `reports/` | 18 | 104 |
| `admin/` | 11 | 99 |
| `tier4/` | 7 | 89 |
| `customer-portal/` | 9 | 49 |
| `shopify/` | 9 | 33 |
| `restaurant/` | 6 | 27 |
| `integrations/` | 7 | 20 |
| `manufacturer-portal/` | 2 | 10 |

**Guard-usage census:**

| Guard | Calls | Files |
|---|---|---|
| `requirePerm(` | 372 | 113 |
| `requireFeature(` | 225 | 86 |
| `validate(` | 243 | 62 |
| `requireAnyPerm(` | 150 | 52 |
| `requireMode(` | 39 | 27 |
| `requirePlanLimit(` | **3** | 3 |
| `requireActiveSubscription` | **0 per-route** | app-level only |

---

## 1. Mount order — who runs before tenant middleware

### 1a. Pre-tenant chain (exact execution order)

| # | Where | Mount | Auth model |
|---|---|---|---|
| 1 | `index.js:196-197` | `routes/admin/index.js` → `/api/admin/*` + `/api/announcements/*` | super-admin JWT |
| 2 | `registerAllRoutes.js:52-148` | inline `GET /api/health` | none |
| 3 | `:151` | `webhooks.js` → `/api/webhooks/*` | signature only |
| 4 | `:154-156` | `sandbox.js` — **only if `PAYMENT_GATEWAY === "sandbox"`** | none |
| 5 | `:159` | `receipts.js` → public receipt | none |
| 6 | `:163` | `gift-cards-public.js` | none |
| 7 | `:166` | `storefront.js` (16 endpoints) | none; manual tenant resolve |
| 8 | `:170-172` | `publicRestaurantLimiter` + `public-restaurant.js` | none |
| 9 | `:175` | `restaurant/pay-at-table.js` public half | none, `webhookLimiter` |
| 10 | `:178` | `public-reservations.js` | none |
| 11 | `:181` | `public-bookings.js` (11 endpoints) | none |
| 12 | `:185` | `public-rentals.js` | flag-gated in handler |
| 13 | `:189` | `public-rooms.js` | none |
| 14 | `:193` | `public-forms.js` | single-use token |
| 15 | `:197` | `public-inquiries.js` | none + optional Turnstile |
| 16 | `:202` | `member-kiosk.js` | none |
| 17 | `:207-215` | `customer-portal/{auth,data,payments,appointments,stays,treatments,packages,forms,gallery}` | `loadCustomerAuth`, scope `customer` |
| 18 | `:220-221` | `manufacturer-portal/{auth,data}` | `loadManufacturerAuth`, scope `manufacturer` |
| 19 | `:230` | `setup.js` | setup token |
| 20 | `:233` | `country-packs.js` | none |

### 1b. The tenant wall (`registerAllRoutes.js:236-282`)

```
236  loadTenantAndPerms (MT) | loadEmployeePerms (ST)
239  resolveTenant
242  tenant-scoped /uploads static
250  loadCompanyProfile
256  resolveOutletContext()
262  resolveEffectiveRole
263  resolveContext
267  requireActiveSubscription
270  requireContextOutlet
273  requestId.enrichReqLog
274  ensureDefaultRolePermissions(db)   ← one-shot boot call, not middleware
282  enforceOutletAssignment()
```

`MULTI_TENANT=1` is set in `.env`, `.env.production`, and `.env.test` — the MT branch is the live path everywhere.

### 1c. Load-bearing registration-order dependencies

- **`orders.js` must precede `shopify`** — `:649` destructures `processPendingShopifyInventoryEvents` / `enqueueInventorySyncEvents` / `upsertWebOrderFromShopifyPayload` from its return and splices them into `shopifyDeps` at `:654-659`.
- **`reports/index.js` at `:538`** returns the schedule processor consumed by the worker.
- **`restaurant/pay-at-table.js` is registered twice** with different exports: public half at `:175` (pre-tenant), staff half at `:721` (post-tenant).

---

## 2. `registerAllRoutes.js` is not an orchestrator

| Lines | What |
|---|---|
| 52-148 | `GET /api/health`. `?deep=true` probes DB (3 s timeout) and Resend (5 s). DB down → `"down"` + **503**; optional dep down → `"degraded"` + 200. Feeds `alerting.recordHealthCheckFailure` |
| 170-171 | `app.use("/api/public/restaurant", publicRestaurantLimiter)` — limiter mounted inline |
| 242-248 | MT tenant `/uploads` static shim |
| 256 / 262 / 282 | outlet context / effective role / outlet assignment |
| 284-302 | **Blanket `PERMISSION_RULES` middleware** — `/api/` only; first matching `{methods, path}` wins; pass requires `all_access` or any `rule.anyPerms`; else 403. Runs *before* every route module and *in addition to* each route's own guard |
| 304-315 | Restore guard → 503 on non-GET while `isRestoreInProgress` |
| 318-361 | Reports telemetry — monkey-patches `res.json` to sniff row counts, logs JSON on `finish` |
| 365-429 | **`GET /api/feature-flags`** — auth is `x-employee-id` **presence only** (`:366-369`, 401 if falsy, no value check). Merges DB rows over defaults; adds per-outlet `effective` (`:401-414`); missing table → static defaults with 200 |
| 431-467 | `PUT /api/feature-flags/:key` — `requirePerm("all_access")` + `rejectCatalogManagedFlagWrites` (409 for module-managed) |

**`enforceOutletAssignment`** (`middleware/outlet-context.js:194-234`) skips `/api/attendance/pin-` (:198), skips when no `x-employee-id` (:200), keys the bypass on **`req.baseEmployeePerms`** not effective perms (:205 — deliberate: an outlet role override cannot widen outlet reach), skips `all_access` (:206) and `execute_field_sales` (:212), then precedence `context → query.outlet_id → body.outlet_id` (:214-217).

---

## 3. File inventory

### 3a. Top-level `backend/routes/*.js` — 111 files

| File | Ep | Mount path(s) | Responsibility |
|---|---|---|---|
| `admin.js` | 0 | — | re-export shim |
| `ai.js` | 2 | `/api/ai/*` | LLM catalog content + invoice extraction |
| `approval-policies.js` | 7 | `/api/approval-policies`, `/api/approvals` | POS override rules |
| `attendance.js` | 13 | `/api/attendance` | Clock in/out + kiosk PIN |
| `attribute-sets.js` | 4 | `/api/attribute-sets` | Variant attributes |
| `auth.js` | 12 | `/api/auth`, `/api/context` | Login/refresh/reset/signup + bootstrap |
| `backorders.js` | 5 | `/api/backorders` | Wholesale backorders |
| `barcode-expenses.js` | 23 | 7 prefixes | Barcode jobs + expense ledger |
| `batches.js` | 5 | `/api/batches`, `/api/products` | Lot/expiry |
| `billing.js` | 7 | `/api/billing` | Subscription + checkout |
| `bookings.js` | 18 | `/api/appointments` +3 | Appointment scheduling |
| `brands.js` | 4 | `/api/brands` | Brand CRUD |
| `business-modules.js` | 4 | `/api/business-modules` | Module toggles |
| `categories.js` | 6 | `/api/categories` | Hierarchical categories |
| `classes.js` | 13 | `/api/classes` | Class sessions + waitlist |
| `client-service-records.js` | 6 | `/api/service-records` | Salon history |
| `commissions.js` | 8 | `/api/commissions` | Plans + earnings |
| `contracts.js` | 8 | `/api/contracts` | Service contracts |
| `country-packs.js` | 2 | `/api/country-packs` | **Pre-tenant, public** |
| `couriers.js` | 10 | `/api/couriers`, `/api/orders` | Courier CRUD + ship/track |
| `customer-display.js` | 2 | `/api/pos/customer-display` | In-memory display cart |
| `customer-invoices.js` | 10 | `/api/customer-invoices` | A/R |
| `customers.js` | 27 | `/api/customers` +2 | CRUD, wallet, loyalty |
| `draft-orders.js` | 7 | `/api/draft-orders` | Hold/resume |
| `email.js` | 5 | `/api/email` | SMTP receipts |
| `employees.js` | 15 | `/api/employees` | CRUD, PIN, outlets, revoke |
| `fbr.js` | 7 | `/api/fbr` | Tax e-invoicing queue |
| `field.js` | 7 | `/api/field/*`, `/api/admin/field-routes` | Field-rep app |
| `forms.js` | 10 | `/api/forms` | Form builder |
| `fulfillment.js` | 29 | `/api/fulfillment` | Picklists, loadsheets, COD |
| `gift-cards.js` | 7 | `/api/gift-cards` | CRUD + redemption |
| `gift-cards-public.js` | 1 | `/api/gift-cards/public/:code` | **Pre-tenant** |
| `grn.js` | 11 | `/api/grn` | Goods receipt + payables |
| `handouts.js` | 5 | `/api/handouts` | Physio handouts |
| `holds.js` | 9 | `/api/holds` | Layaway |
| `import.js` | 7 | `/api/import/*` | Bulk CSV/XLSX |
| `insights.js` / `insights-ai.js` | 1 / 1 | `/api/insights/auto`, `/ask` | Analytics + AI chat |
| `inventory.js` | 14 | `/api/transfers`, `/adjustments`, `/stock-counts` | Stock ops |
| `inventory-intelligence.js` | 11 | `/api/inventory-intelligence/*` | ABC, cycle counts |
| `item-suggestions.js` | 5 | `/api/pos`, `/api/product-affinities` | Upsell |
| `kds.js` | 11 | `/api/kds` | Kitchen display |
| `loyalty.js` | 4 | `/api/loyalty` | Loyalty rules |
| `manufacturer-partners.js` | 6 | `/api/manufacturer-partners` | Admin partner CRUD |
| `marketing.js` | 11 | `/api/marketing` | Campaigns |
| `member-kiosk.js` | 2 | `/api/member-kiosk/*` | **Pre-tenant** gym kiosk |
| `members.js` | 4 | `/api/members` | Member lookup |
| `messaging.js` | 4 | `/api/messaging` | Customer inbox |
| `modifiers.js` | 11 | `/api/modifiers`, `/api/products` | POS modifiers |
| `notification-settings.js` | 7 | `/api/notification-settings` | Channel rules |
| `orders.js` | 15 | `/api/orders`, `/api/products` | Web orders + **3 Shopify helpers** |
| `outlets.js` | 4 | `/api/outlets` | Outlet CRUD |
| `outlet-tax-profiles.js` | 5 | `/api/outlet-tax-profiles` | Per-outlet tax |
| `outlet-visibility.js` | 4 | `/api/outlet-visibility` | Product visibility |
| `override-reasons.js` | 4 | `/api/override-reasons` | Manager override codes |
| `packages.js` | 8 | `/api/packages` +2 | Session passes |
| `parked-sales.js` | 4 | `/api/parked-sales` | Park/retrieve |
| `pos-devices.js` / `pos-layouts.js` | 4 / 5 | `/api/pos-devices`, `/api/pos-layouts` | Device + layout |
| `price-books.js` | 5 | `/api/price-books` | Price books |
| `price-list-assignments.js` | 7 | 3 prefixes | Assignment + resolver |
| `price-lists.js` | 1 | `/api/price-lists` | ⚠️ bulk lives in `products.js` |
| `printer.js` | 6 | `/api/print` | ESC/POS |
| `products.js` | 34 | 5 prefixes | CRUD, bulk, reviews, price lists |
| `product-serials.js` | 3 | serial endpoints | Serial tracking |
| `projects.js` | 13 | `/api/projects` +2 | Service projects |
| `promotions.js` | 5 | `/api/promotions` | Promo rules |
| `public-*.js` (7 files) | 27 | `/api/public/*` | **Pre-tenant** guest flows |
| `purchase-orders.js` | 10 | `/api/purchase-orders` | PO CRUD |
| `recalls.js` | 8 | `/api/recalls` +2 | Clinical recalls |
| `receipts.js` | 1 | `/api/receipts/:invoiceNumber/public` | **Pre-tenant** |
| `receipt-templates.js` | 9 | +`/api/action-history` | Layouts + audit |
| `registerAllRoutes.js` | 3 | health, feature-flags ×2 | Orchestrator + inline |
| `rentals.js` | 32 | 4 prefixes | Rental lifecycle |
| `report-builder.js` | 7 | `/api/reports/builder…` | Custom reports |
| `restaurant.js` | 22 | `/api/restaurant` | Floor, tables, tabs, KOTs |
| `restaurant-inbox.js` / `restaurant-kiosk.js` | 3 / 4 | inbox, kiosk tokens | Online orders, QR |
| `return-policies.js` / `returns.js` | 6 / 5 | policies, `/api/returns` | Returns |
| `risk-controls.js` | 8 | `/api/risk` | Fraud controls |
| `roles.js` | 7 | `/api/roles`, `/api/permissions-catalog` | Roles + perms |
| `rooms.js` | **51** | 7 prefixes incl. `/api/reports` | Lodging — **largest** |
| `sales.js` | 5 | `/api/sales` | Checkout, void, detail (**130 KB — largest file**) |
| `sandbox.js` | 4 | `/api/sandbox` | **Conditional pre-tenant** |
| `scheduled-changes.js` | 3 | `/api/catalog` | Scheduled changes |
| `schedules.js` | 6 | `/api/schedules` | Staff scheduling |
| `service-tickets.js` | 20 | `/api/service-tickets` | Repair workflow |
| `setup.js` | 2 | `/api/setup/*` | **Pre-tenant** wizard |
| `shifts.js` | 7 | `/api/shifts` | Cash shifts |
| `smart-collections.js` | 5 | `/api/smart-collections` | Rule collections |
| `stock-conversions.js` | 2 | `/api/stock-conversions` | Kit/BOM runs |
| `storefront.js` | 16 | `/api/storefront` | **Pre-tenant** (51 KB) |
| `subscriptions.js` | 13 | 3 prefixes | Recurring billing |
| `supplier-returns.js` / `suppliers.js` | 3 / 4 | RMA, suppliers | |
| `support.js` | 3 | `/api/support` | Tickets + upload |
| `taxes.js` / `tax-lookup.js` | 4 / 3 | `/api/taxes`, `/api/tax-lookup` | Tax rates, HS codes |
| `tips.js` | 9 | `/api/tips` | Capture + pooling |
| `treatment-plans.js` | **43** | 8 prefixes | Clinical plans |
| `treatment-plan-templates.js` | 5 | templates | |
| `van.js` | 6 | `/api/van` +1 | Van sales |
| `webhooks.js` | 7 | `/api/webhooks/*` | **Pre-tenant** (§5) |
| `woocommerce.js` | 5 | `/api/integrations/woocommerce/*` | Woo connector |

### 3b. `admin/` — 11 files, 99 endpoints, all pre-tenant

`index.js` (0, builds deps + `tenantDbManager.init`), `helpers.js` (0), `auth.js` (10), `tenants.js` (27), `messaging.js` (15), `operations.js` (14), `billing.js` (10), `compliance.js` (7), `system.js` (7), `monitoring.js` (6), `module-locks.js` (3).

### 3c. `reports/` — 18 files, 104 endpoints
`sales` 18, `inventory` 20, `analytics` 14, `governance` 13, `finance` 7, `shifts` 7, `purchasing` 5, `clinical` 5, `staff` 4, `multichannel` 3, `dashboard` 2, `recipe-costing` 2, `fbr-export` 1, `kds-analytics` 1, `menu-engineering` 1, `stock-aging` 1, plus 2 orchestrators.

### 3d. `tier4/` — 7 files, 89 endpoints, **mounted prefix-less**
`accounting.js` 43 (`/api/accounting/*`), `crm.js` 16, `hr.js` 12, `company-profile.js` 8, `approvals.js` 6, `notifications.js` 4, `index.js` 0.

### 3e–3i. Other subdirectories
- **`shopify/`** 9 files, 33 ep — `mappings` 9, `health` 6, `reconciliation` 5, `sync` 5, `config` 3, `import` 3, `orders` 1, `webhooks` 1
- **`integrations/`** 7 files, 20 ep, all under `app.use("/api/integrations", router)`; every sub-module signature is `(router, deps)`
- **`restaurant/`** 6 files, 27 ep — reservations 7, waitlist 5, menu-schedules 4, void-comp 4, pay-at-table 4 (split), availability 3
- **`customer-portal/`** 9 files, 49 ep, all pre-tenant — `data` 19, `auth` 9, `appointments` 7, `gallery` 4, `treatments` 4, `forms` 3, `packages`/`payments`/`stays` 1 each
- **`manufacturer-portal/`** 2 files, 10 ep — `auth` 5, `data` 5

---

## 4. Sampled middleware stacks

### 4.1 `sales.js`
| Endpoint | Stack | Line |
|---|---|---|
| `GET /api/sales` | `requireAnyPerm(["view_sales_reports","all_access"])` | 155 |
| `GET /api/sales/by-barcode/:code` | `requireAnyPerm([… ,"pos_park", …])` | 239-241 |
| `GET /api/sales/:id` | `requireAnyPerm(["view_sales_reports","all_access"])` | 278 |
| `PUT /api/sales/:id/void` | `requireAnyPerm(["void_sales","pos_void"])` + Zod | 334-337 |
| **`POST /api/sales`** | **`validate(CreateSaleSchema)` only — no permission guard** | 595 |

Not covered by any `PERMISSION_RULES` entry either (all of `middleware/permissions.js:126-365` read). Access is gated purely by "have a valid tenant JWT."

### 4.2 `products.js`
`GET /api/products` (:209) accepts **six** permissions. Writes use `requirePerm("manage_inventory")`. `POST /api/products` (:790) is the only place stacking three guards (perm + `requirePlanLimit("products")` + Zod). Two ungated endpoints hide here: `GET /api/products/:id/reviews` (:1837, **no guard**) and `POST` (:1861, `reviewLimiter` only). Also owns the entire `/api/price-lists` CRUD surface (:1617-1836).

### 4.3 `employees.js`
Reads `requireAnyPerm(["manage_employees","all_access"])` (:48); writes `requirePerm("all_access")` (:91,119,174,199,283,360,510). Token revocation is `manage_employees`-delegable (:306,331). Three self-scoped endpoints have **no permission guard**: change-password (:388), change-pin (:432), `/me/preferences` (:473,488 — not even validated). `POST /api/employees/validate-pin` (:65) is `pinValidateLimiter` + Zod only, by design.

### 4.4 `roles.js`
All CRUD `requireAnyPerm(["manage_roles"])`. `requireSelfRoleOrAdmin` (:119-144) on `GET /:id/permissions` falls back to an `x-employee-id` DB lookup when `role_id` is null. Three in-body guardrails on `PUT /:id/permissions`: role 1 admin-only (:172), non-admins can't grant `all_access` (:176), every string must pass `isKnownPermission` (:186-194), plus a transactional last-admin lockout check throwing `CANNOT_REMOVE_LAST_ADMIN` (:209-227).

### 4.5 `business-modules.js`
| Endpoint | Guard |
|---|---|
| `GET /` | `requireAnyPerm(["manage_business_modules","manage_outlet_modules"])` |
| `GET /:key/impact` | same pair |
| `POST /:key/toggle` | `requirePerm("manage_business_modules")` + Zod |
| `POST /:key/outlet-toggle` | both + Zod |

Neither perm is in `DEFAULT_ROLE_PERMISSIONS`, so only `all_access` holders reach it until granted.

### 4.6 `billing.js`
Reads `/pricing` (:49), `/status` (:116), `/usage` (:195), `/payment-history` (:396) have **no guards**. All writes `requirePerm("all_access")`.

### 4.7 `field.js`
`repSelfPerm = requireAnyPerm(["execute_field_sales","manage_field_sales"])` (:33). Rep-self surfaces use it; owner surfaces (`/visits`, `/summary`, admin routes) use `requirePerm("manage_field_sales")`. Self-scoping is in-handler, not middleware. `execute_field_sales` also buys an `enforceOutletAssignment` bypass.

### 4.8 `admin/auth.js`
Across all 11 admin files, exactly **two** endpoints lack `requireSuperAdmin`: `POST /api/admin/auth/refresh` (:294, cookie-only) and `GET /api/announcements/active` (`messaging.js:436`, fully public).

### 4.9 Public route pattern
All three `public-restaurant.js` endpoints (:123,191,269): no middleware, first statement `await resolvePublicTenantDb(req, deps)`, then `if (resolved.error) return res.status(resolved.status)…`. Limiter applied externally.

### 4.11 `reports/*` permission map

| File | Permission | Extra gates |
|---|---|---|
| `sales.js` | `view_sales_reports`; profit → `view_financial_reports` | `reports_profit_layer` |
| `inventory.js` | `view_inventory_reports` (+`manage_inventory`) | `reports_inventory_health_plus` |
| `analytics.js` | mixed sales/customer/financial | `reports_profit_layer`, `reports_exceptions` |
| `finance.js`, `purchasing.js` | `view_financial_reports` | — |
| `staff.js` | `view_hr_reports` | — |
| `governance.js` | `manage_reports` | `reports_scheduled_exports` |
| `clinical.js` | `view_customer_reports` + | `phase4_treatment_plans` |
| `kds-analytics.js` | `view_sales_reports` | `requireMode("restaurant")` + flag |
| `menu-engineering.js` | `view_financial_reports` | `requireMode("restaurant")` + flag |
| `fbr-export.js` | **`requirePerm("all_access")`** | — |

### 4.12 Files with endpoints but zero guards
31 files. Almost all intentionally pre-tenant/public. **Four are post-tenant** and therefore reachable by any authenticated employee regardless of role: `customer-display.js` (2), `tax-lookup.js` (3, incl. a write), `support.js` (3, incl. file upload), `billing.js` reads (4).

---

## 5. Webhooks — `backend/routes/webhooks.js` (900 lines)

Raw body captured globally by `express.json({verify})` in `index.js:130-143`.

| Endpoint | Verified | Header | Digest | Secret | Order |
|---|---|---|---|---|---|
| `POST /api/webhooks/xpay` (:536) | ✅ | adapter | adapter | env | verify → process; 400 on fail |
| `GET /api/webhooks/meta` (:604) | ✅ | `hub.verify_token` | — | env | 403 |
| `POST /api/webhooks/meta` (:619) | ✅ | `x-hub-signature-256` | **hex** | `META_APP_SECRET` | verify **before** tenant routing; 401 |
| `GET /api/webhooks/whatsapp` (:676) | ✅ | `hub.verify_token` | — | env | 403 |
| `POST /api/webhooks/whatsapp` (:691) | ✅ | `x-hub-signature-256` | hex | `WHATSAPP_APP_SECRET` → `META_APP_SECRET` | 401 |
| `POST /api/webhooks/daraz` (:777) | ❌ **none** | — | — | — | `webhookLimiter` only; 20-line rationale at :757-776 |
| `POST /api/webhooks/{foodpanda,careem}` (:846) | ✅ | source-specific | **base64** | **per-tenant**, decrypted | **route first, then verify** (:851-867) |
| `POST /api/integrations/shopify/webhooks/orders-create` | ✅ *(unreachable — §6.1)* | `x-shopify-hmac-sha256` | base64 | per-connection | + shop-domain match + replay window |

**Non-interchangeable verification implementations:**
- `services/meta-webhook.js:131` — hex digest, `/^sha256=([0-9a-f]{64})$/i` shape check, constant-time compare, refuses when secret unset (`no_app_secret_configured`), distinguishes `no_raw_body` from empty body. `verifyHandshake` (:99-106) refuses first when the expected token is unset — the fix for the `undefined === undefined` bypass.
- `services/aggregator-orders.js:125` — **base64** digest, conditional ±5 min replay window, length pre-check before `timingSafeEqual` (:128).

Both Meta and aggregator rejections feed `alerting.recordError` so a fail-closed rejection storm surfaces.

`webhooks.js` is the **only** route file defining an inline Zod schema — `XPayPayloadSchema` (:526-531), deliberately `.passthrough()` and **non-fatal** (:547-554), because HMAC is the real gate.

---

## 6. Zod schema coverage

**52 schema files. Zero orphans** — every one is imported by at least one route file. Multi-consumer schemas pair a public route with its authenticated twin (`bookings`↔`public-bookings`, `rooms`↔`public-rooms`, `forms`↔`public-forms`, etc.).

**The gap is the inverse direction** — 62 of 180 route files call `validate(`. Files with >3 write endpoints and zero validation:

| File | Writes / Total |
|---|---|
| **`tier4/accounting.js`** | **19 / 43** |
| `fulfillment.js` | 16 / 29 |
| `barcode-expenses.js` | 10 / 23 |
| `tier4/crm.js` | 9 / 16 |
| `couriers.js`, `admin/auth.js` | 8 / 10 |
| `admin/operations.js`, `storefront.js` | 7 |
| `import.js`, `shopify/mappings.js`, `reports/governance.js` | 6 |
| 8 more files | 5 each |
| 14 more files | 4 each |

---

## 7. Notable risks & oddities

1. **`POST /api/integrations/shopify/webhooks/orders-create` is unreachable in MT mode.** Registered at `registerAllRoutes.js:662`, **after** the tenant wall at `:236-239`. `resolveTenant` (`tenant-auth.js:273-275`) returns 401 `AUTH_REQUIRED` for any `/api/` path not on `PUBLIC_TENANT_PARAM_PATHS` with no `req.tenantId`. Shopify sends no `Authorization` and no `?tenant=`. The HMAC verification in `shopify/webhooks.js:35-47` therefore **never executes**. Every other inbound webhook mounts pre-tenant at `:151`; this one does not. → **CONFIRMED live**, see verification log §6.
2. **`GET /api/feature-flags` auth is header presence, not identity** (`registerAllRoutes.js:366-369`). Path is also on the pre-auth `?tenant=` allowlist. → **CONFIRMED live**, verification log §7.
3. **`POST /api/sales` has no permission guard** (`sales.js:595`) and no `PERMISSION_RULES` coverage.
4. **`GET/POST /api/products/:id/reviews` ungated** inside an otherwise strictly-guarded file.
5. **Daraz webhooks accept unsigned payloads** and write into `web_orders`/`daraz_order_map`. `resolveTenantByIntegration` falls back to "the sole active daraz integration" (:789) — dangerous the moment a second tenant connects.
6. **`requirePlanLimit` is called 3 times across 1,344 endpoints.** `"outlets"` appears enforced via `billing.js add-outlet` rather than `POST /api/outlets`.
7. **The `PERMISSION_RULES` prefix trap is real and already worked around twice** — `permissions.js:152` needs a negative lookahead for `my-status` or POS checkout bricks.
8. **Two parallel self-scoped-guard idioms with different trust roots** — `roles.js:119-144` falls back to the `x-employee-id` header; `enforceOutletAssignment` no-ops without it. In MT the JWT is authoritative, so the header path should be dead code.
9. **`tier4/` mounts prefix-less** — 89 endpoints whose paths are discoverable only by reading each leaf file.
10. **`approvals` is double-owned** — `approval-policies.js` (registered `:574`) and `tier4/approvals.js` (via `:471`) both under `/api/approvals`; tier4 wins first-match. *Not exhaustively diffed.*
11. **`price-lists` CRUD lives in `products.js`** — `price-lists.js` has 1 endpoint and loses collisions. Editing it expecting authority means editing dead code.
12. **`sandbox.js` mounts conditionally** on `PAYMENT_GATEWAY=sandbox`, zero auth on 4 endpoints including `POST /api/sandbox/simulate-webhook` which re-enters `processWebhookEvent`.
13. **`admin/` bypasses tenant isolation by construction** — raw pool + master DB, 99 endpoints gated solely by `requireSuperAdmin`.
14. **`rooms.js` registers `/api/reports/*` routes** outside the reports directory and its permission map; only the `PERMISSION_RULES` backstop gates them uniformly.
15. **`customer-portal/auth.js` `/refresh` and `/logout` carry no limiter and no Zod** (:362,415) — `/refresh` is token-minting.

### Could not verify
- Whether `approval-policies.js` and `tier4/approvals.js` collide on identical full paths (prefixes compared, not path sets).
- The exact identity of the third `requirePlanLimit` call site (confirmed `products.js:790`, `employees.js:91`).
- Whether `change-password`/`change-pin` enforce self-scoping in-handler (registration lines read, handler bodies not).
