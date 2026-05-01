# Unit Tests — Claude Guide

- **Vitest** with ESM imports (`import { describe, it, expect, vi }`), no DB/network hits
- **Run**: `npx vitest run backend/tests/unit/`
- **Pattern**: pure function testing with `vi.fn()` / `vi.spyOn()`. No supertest, no Express — except `routes-orders-transactions.test.js`, `routes-admin-worker-status.test.js`, and `routes-admin-monitoring-infra-cache.test.js` which mount mini-Express apps

---

## Mocking Patterns Reference

| Pattern | Files | Why |
|---------|-------|-----|
| `vi.mock()` + `vi.hoisted()` | `workers-email-worker-boss.test.js` | ESM imports resolved at module load — must hoist mock factories |
| `require.cache` eviction + re-require | `middleware.test.js` (plan-limits, feature-flags, tenant-auth), `services.test.js` (alerting, email) | CJS inline `require()` inside closures bypasses `vi.mock()` interception entirely |
| Real function + fake injected deps | `services-booking-reminders.test.js`, `services-catalog-scheduler.test.js`, `workers-tenant-job-context.test.js`, `workers-email-worker-boss.test.js`, `treatment-folio.test.js` | Tests actual logic with a fake `db` object — more realistic than mocks |
| `vi.stubGlobal("fetch", vi.fn())` | `services.test.js` (payment-gateway xPay) | Intercepts `global.fetch` used inside the service |

---

## `middleware.test.js`

Covers 5 middleware modules in one file.

**`middleware/validate.js`** + `schemas/auth.js`
- `validate(schema)` — happy path calls `next()`, validation failure returns `400 { error, details }`; coerces types in `req.body` (e.g. string `outlet_id` → number)

**`middleware/permissions.js`** — `requirePerm`, `requireAnyPerm`
- `requirePerm("perm")` — allows matching perm or `all_access`; 403 otherwise; reads `req.employeePerms`
- `requireAnyPerm(["p1","p2"])` — allows if any perm matches

**`middleware/plan-limits.js`** — `requirePlanLimit`, `requireActiveSubscription`
- `requirePlanLimit(resource)` — skips when `MULTI_TENANT` not `"1"`; checks outlet/employee/product caps; returns `{ code: "PLAN_LIMIT_REACHED" }` on 403; throws at factory time for unknown resource
- `requireActiveSubscription` — skips GET and `/api/auth/` routes; returns `{ code: "SUBSCRIPTION_EXPIRED" }` on 403 when `payment_status = "expired"`; passes for `"trial"`, `"active"`, `"grace"`
- **CJS require.cache injection**: `plan-limits.js` does inline `require()` inside closures — tests evict module from `require.cache` and inject fake `master-db-pg.js` + `tenant-db-manager-pg.js` before re-requiring

**`middleware/feature-flags.js`** — `requireFeature`, `invalidateFeatureFlagCache`, `DEFAULT_FEATURE_FLAGS`
- Uses `init(deps)` DI pattern — call `invalidateFeatureFlagCache()` between tests to clear in-memory cache
- `DEFAULT_FEATURE_FLAGS` all-boolean assertion test

**`middleware/upload-validation.js`** — `imageFileFilter`, `rasterImageFileFilter`, `safeExtension`, `detectImageType`, `verifyImageMagicBytes`, `ALLOWED_IMAGE_MIMES`
- `imageFileFilter` — accepts jpeg/png/webp/gif/svg+xml; rejects pdf, exe extension, null file, missing MIME
- `rasterImageFileFilter` — same as above but also rejects SVG (P31: prevents XSS via SVG upload to product images)
- `detectImageType(buf)` — magic-byte sniff: JPEG (FF D8 FF), PNG (89 50 4E 47), GIF87a/GIF89a, WEBP (RIFF...WEBP), BMP (BM), TIFF LE/BE; returns null for DOS MZ header (P32: EXE-as-jpg attack) and empty/null input
- `verifyImageMagicBytes(buf, mimetype)` — cross-checks sniffed type against claimed MIME
- `safeExtension(filename, mimetype)` — returns allowed ext or falls back to MIME-derived; falls back to `.png` for unknown MIME

**`middleware/tenant-auth.js`** — `loadTenantAndPerms` (two separate describe blocks)
- JWT error handling: corrupt signature → `401 { code: "INVALID_TOKEN" }`; malformed token → `401 INVALID_TOKEN`; expired → `401 TOKEN_EXPIRED`; no header → `next()` with empty perms
- P28 email hydration: middleware must `SELECT email` from employees and assign to `req.employee.email` — `routes/support.js` reads this for the `support_received` confirmation email

---

## `services.test.js`

Covers 4 services.

**`services/alerting.js`** — `recordError`, `recordDbPressure`
- `recordError`: threshold 10 per 5-min window; fires alert on 10th event, resets window (second burst of 9 does not re-alert)
- `recordDbPressure`: threshold 1 — first call always alerts
- **Require.cache pattern**: `alerting.js` has module-level mutable `windows` Map; each test evicts and re-requires to get empty state; `alertEmail.js` stays loaded so `vi.spyOn` can intercept

**`services/payment-gateway.js`** — `isEnabled`, `createCheckout`, `verifyWebhook`
- `isEnabled()` — false when `PAYMENT_GATEWAY` unset or `"manual"`, true for `"xpay"`
- `createCheckout()` — throws `"not configured"` in manual mode; calls xPay URL with `Authorization: Bearer <XPAY_API_KEY>`; returns `{ checkout_url, gateway_ref }` from xPay response
- `verifyWebhook("unknown_gw", ...)` — returns `{ valid: false }`

**`services/fbr.js`** — `buildInvoicePayload`, `buildCreditNotePayload`, `getNextRetryDelay`, `BACKOFF_DELAYS`
- `BACKOFF_DELAYS` exported constant: `[60, 300, 900, 3600, 14400]` seconds
- `getNextRetryDelay(attempt)` reads `BACKOFF_DELAYS[attempt]`; clamps to last value for out-of-bounds
- `buildInvoicePayload(sale, items, company, customer, outlet)` — `invoiceType: "Sale Invoice"`, `invoiceRefNo = invoice_number`, `buyerBusinessName = "Walk-in Customer"` when no customer
- `buildCreditNotePayload` — `invoiceType: "Credit Note"`, falls back to `"RET-{id}"` when `return_number` absent

**`services/email.js`** — `resolveFrom`, `sendEmail`
- `resolveFrom("receipt", { slug, name })` → `"Name <slug@sanopos.com>"`; lifecycle/billing/support types → `"SanoPOS <noreply@sanopos.com>"`; uses `RESEND_FROM_EMAIL` env var if set
- `sendEmail` — throws on unknown `type`; throws when `RESEND_API_KEY` unset; calls `resend.emails.send` with correct from/to/subject

---

## `utils.test.js`

Tests `services/email-templates.js` and two email utilities.

**`services/email-templates.js`** — `TEMPLATES`, `wrapEmailHtml`
- `TEMPLATES` registry must export exactly these **15 keys**: `drip_getting_started`, `drip_features`, `billing_payment_recorded`, `billing_plan_changed`, `billing_expiry_warning`, `billing_overdue`, `support_received`, `support_resolved`, `trial_warning`, `trial_ended`, `account_locked`, `renewal_due`, `renewal_overdue`, `downtime`, `announcement`
- `wrapEmailHtml(title, body)` — returns `<!DOCTYPE html>` document; omits subtitle element when title falsy

**`utils/receiptEmail.js`** — `buildReceiptEmailHtml(sale, items, payments, template, currencyCode)` — pure HTML builder; includes invoice number, item names, currency symbol

**`utils/digestEmail.js`** — `buildDigestEmailHtml(data, storeName, date)` — includes company name and formatted revenue

---

## `tz.test.js`

Tests `utils/tz.js`: `toUtcStart`, `toUtcEnd`, `toLocalDateStr`, `getUtcOffsetMinutes`, `isValidTz`

- `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` — converts local `YYYY-MM-DD` to UTC boundary strings; invalid tz falls back to UTC; null `dateStr` returns null
- DST edge cases: spring-forward day (US 2026-03-08) span is 23h; fall-back day (US 2026-11-01) span is 25h
- Timezones covered: UTC, Asia/Karachi, America/New_York, America/Los_Angeles, Pacific/Auckland, Pacific/Kiritimati (UTC+14), Etc/GMT+12, Europe/London (GMT winter vs BST summer)
- `isValidTz(str)` — accepts IANA names; rejects `"PKT"`, `"Bogus/Zone"`, null, undefined, number
- `getUtcOffsetMinutes(dateStr, tz)` — returns signed offset minutes; 0 for invalid tz

---

## `routes-admin-worker-status.test.js`

Tests `GET /api/admin/worker-status` in `routes/admin/system.js`

- **8 worker slots** (after P15): `email`, `fbr`, `cleanup`, `reservation`, `marketplace_sync`, `booking_reminder`, `subscription_grace`, `catalog_scheduler`
- Response shape per slot: `{ enabled, running, last_poll_ago_seconds?, processed_today?, queue_depth? }`
- `enabled: false, running: false` when `global.__<name>WorkerStatus` is unset
- `running: true` when `lastPollAt` is within freshness threshold (each worker has its own: catalog_scheduler=60s×2.5, booking_reminder=5min×2.5, etc.)
- Saves/restores global keys in `beforeEach`/`afterEach`

---

## `routes-orders-transactions.test.js`

Tests `POST /api/orders/:id/transactions` in `routes/orders.js`

- Mounts orders router on mini-express with all `deps` injected
- Verifies INSERT lists exactly **11 params** (`$1..$11`): includes v25 columns `provider_ref`, `payment_context`, `webhook_event_id`
- `payment_context` defaults to `"billing"` when omitted
- `provider_ref` and `webhook_event_id` default to `null` when omitted

---

## `routes-admin-monitoring-infra-cache.test.js`

Tests `/api/admin/infra` endpoint cache behavior in `routes/admin/monitoring.js`

- First call: cache miss (`X-Infra-Cache: miss`), populates cache, runs ≥7 DB queries, response includes `cached_at` and `cache_ttl_seconds: 300`
- Second call within TTL: cache hit (`X-Infra-Cache: hit`), no additional DB queries, body identical to first
- `?force=1`: bypasses cache, re-queries, returns `X-Infra-Cache: miss`
- Uses `vi.resetModules()` + minimal Express app stub (no real HTTP)

---

## `services-booking-reminders.test.js`

Tests `services/booking-reminders.js` — `processPendingReminders(db, boss)`

- Returns count of rows processed (not count of notifications sent)
- Enqueues `"email"` pg-boss job for email-channel reminders with `to`, `subject` containing service name
- Marks row `status = 'sent'` on success; `status = 'failed'` when `boss.send` throws
- **SMS pre-existing bug**: SMS channel skips enqueue but still marks row as `sent` — documented as expected behavior, do not "fix" without test update

---

## `services-catalog-scheduler.test.js`

Tests `services/catalog-scheduler.js` — `applyScheduledChange(db, change)`

- Always returns `{ status, reason? }` — never throws; one bad row doesn't abort a batch
- **Allowlist enforcement**: `field_name` must be in `CHANGE_TYPES` for its entity type; non-allowlisted → skips `db.transaction()`, marks row `'failed'`; SQL injection string → blocked at allowlist check before any UPDATE
- Entity types: `"product"` and `"variant"` use separate field allowlists; fields valid for one are not necessarily valid for the other
- UPDATE error → transaction rolled back, pool-level `'failed'` UPDATE runs, returns `{ status: 'failed' }`

---

## `workers-email-worker-boss.test.js`

Tests 4 tenant-scoped job handlers in `workers/email-worker-boss.js`

Handlers: `subscription-renewal`, `campaign-scheduled-send`, `invoice-reminder`, `campaign-email`

- All handlers throw when `tenantSlug` is absent from job payload
- All handlers set `SET search_path TO tenant_{slug}` before running service logic and reset to `public` in finally block (even on error)
- Uses real `withTenantContext` with fake pg.Pool — exercises actual ALS + search_path behavior
- Mocks: `resend`, `services/email-templates`, `services/subscriptions`, `services/marketing` via `vi.hoisted()`

---

## `workers-tenant-job-context.test.js`

Tests `workers/tenant-job-context.js` — `assertSafeSlug`, `withTenantContext`

**`assertSafeSlug(slug)`** — accepts `[a-z0-9_]+` only; rejects hyphens, uppercase, spaces, semicolons, SQL injection strings, Unicode; throws `/required/` for null/undefined/empty; throws `/unsafe/` for bad chars

**`withTenantContext(pool, slug, callback)`**
- Sets `search_path TO tenant_{slug}` before callback runs
- Resets `search_path TO public` in finally block (even when callback throws)
- Releases pool client even if reset query fails
- Rejects unsafe slug without ever calling `pool.connect()`
- Returns callback's return value
- Transaction proxy: wraps `db.transaction()` callback in `BEGIN`/`COMMIT`; rolls back and rethrows on error

---

## `customer-portal-auth.test.js`

Tests `middleware/customer-auth.js` — `signCustomerTokens`, `verifyCustomerToken`, `hashRefreshToken`

- `signCustomerTokens(customer, tenant)` — issues access token with `scope: "customer"`, `cid`, `tid`, `tslug`, `jti` claims; issues refresh token with `type: "refresh"` and SHA-256 hash
- `verifyCustomerToken(token)` — accepts self-signed tokens; rejects tokens signed with other secrets
- OTP format: `crypto.randomInt(100000, 1000000)` always produces 6-digit string
- Rate limiters: `customerPortalAuthLimiter`, `customerPortalOtpLimiter`, `customerPortalDataLimiter` all exported from `middleware/rate-limit.js`

---

## `feature-flags-modes.test.js`

Tests `requireMode` middleware from `middleware/feature-flags.js`

- `requireMode("restaurant")` — calls `next()` when mode row exists with `enabled: true`; returns 403 with `{ mode: "restaurant" }` when mode absent from DB; calls `next()` (backward compat) when `tenant_modes` table doesn't exist; calls `next()` when modes map is empty
- Caches mode lookups; second call within TTL skips DB
- `invalidateModeCache()` forces re-query on next call

---

## `industry-config.test.js`

Tests `config/industry-config.js` exports: `INDUSTRY_PRESETS`, `VALID_INDUSTRY_TYPES`, `DEFAULT_INDUSTRY_TYPE`, `WEIGHTED_UNITS`, `DEFAULT_UNIT_VOCABULARY`, `DEFAULT_PUBLIC_BOOKING_LABELS`, `getPreset`, `getPresetLabels`, `getUnitVocabulary`, `isWeightedUnit`, `getPublicBookingLabels`

- **23 presets**: 10 v1 (general_retail, grocery, café, restaurant, salon, clinic, repair_shop, gym, photography_studio, wholesale) + 3 M5 weighted (butcher, sweet_shop, textile) + 4 M7 rentals (car_rental, equipment_hire, furniture_rental, party_supplies) + 3 M9 hospitality (hotel, guesthouse, hostel) + 3 M10 clinical (dental_clinic, veterinary, physiotherapy)
- Every preset has: `industry_type`, `business_model`, `display_name`, `modes`, `labels` (incl. product/products/customer/customers/sale/order), `dashboard_widgets`, `onboarding_steps`, `pos_layout_mode`
- `getPreset(unknown)` falls back to `general_retail`
- M5 helpers: `isWeightedUnit` case-insensitive; `getUnitVocabulary` preset-specific or default; `getPresetLabels` merges M5 defaults for `quantity_label: "Qty"`, `customer_search_placeholder`
- M6 booking labels: `getPublicBookingLabels(preset)` returns `booking_cta`, `staff_singular`, `service_singular`

---

## `mode-registry.test.js`

Tests `config/mode-registry.js` — `MODE_REGISTRY`, `VALID_MODES`, `getModeConfig`, `getFeatureFlagsForModes`

- `VALID_MODES` matches `Object.keys(MODE_REGISTRY)`
- `getModeConfig("restaurant")` returns `{ description, feature_flags_to_enable: [...] }`; returns `null` for unknown mode
- `getFeatureFlagsForModes(["restaurant","commissions"])` returns union of both modes' flags
- Cross-check: every mode referenced by any preset in `INDUSTRY_PRESETS` must exist in `MODE_REGISTRY`

---

## `portal-presets.test.js`

Tests portal preset config from `config/industry-config.js` — `getPortalLabels`, `getPortalEnabledTabs`, `DEFAULT_PORTAL_LABELS`, `DEFAULT_PORTAL_TABS`

- `getPortalLabels("unknown")` returns `DEFAULT_PORTAL_LABELS`; preset-specific overrides merge over defaults (fallback keys present)
- `getPortalEnabledTabs(preset)` returns tab array; unknown preset falls back to `general_retail`'s list; every preset returns non-empty list; all include `"profile"`
- Rental presets include `"contracts"` tab
- Tab arrays per preset: salon→`[appointments,invoices,loyalty,profile]`, restaurant→`[orders,loyalty,profile]`, wholesale→`[invoices,orders,profile]`, gym→`[subscriptions,invoices,appointments,profile]`, car_rental→`[contracts,invoices,profile]`, repair_shop→`[tickets,invoices,profile]`

---

## `rentals.test.js`

Tests `services/rental-service.js` — `computeLateFee`, `generateContractNumber` + rental presets + mode registry

- `computeLateFee({ expectedReturn, actualReturn, dailyRate, quantity })` — returns 0 when on time or early; rounds up to whole days (`Math.ceil`); multiplies by quantity; accepts string dates; returns 0 on invalid dates
- `generateContractNumber(db)` — format `RNT-{n:6}` zero-padded; extends padding beyond 6 digits for large IDs
- Rental presets (`car_rental`, `equipment_hire`, `furniture_rental`, `party_supplies`): all have `modes: ["rentals"]`, `pos_layout_mode: "list"`, `business_model: "asset_rental"`, `dashboard_widgets.floor_plan: false`
- `car_rental` labels: product=Vehicle, customer=Renter, sale=Contract

---

## `rooms.test.js`

Tests `services/room-service.js` — `resolveRateForDate`, `calculateStayTotal`, `daysBetween`, `addDaysISO`, `generateBookingNumber` + room presets + permissions

- `resolveRateForDate(db, roomTypeId, dateStr)` — returns `room_rate_overrides` rate when available; falls back to `room_types.base_rate`; coerces Postgres NUMERIC string to Number
- `calculateStayTotal(db, { roomTypeId, checkIn, checkOut })` — iterates nights, calls `resolveRateForDate` per night; supports partial override windows; `nights=0` returns `{ nights:0, subtotal:0, rate_breakdown:[] }`
- `daysBetween(a, b)` — returns 0 for same day or reversed range
- `addDaysISO(date, n)` — crosses month/year boundaries
- `generateBookingNumber(db)` — format `BK-{n:6}`
- `DEFAULT_ROLE_PERMISSIONS.Manager` must contain `"manage_rooms"`

---

## `treatment-plans.test.js`

Tests `services/treatment-plan-service.js` — `validateStatusTransition`, `calculateSessionCompletionPct`, `listConsentTemplateKeys`, `getConsentTemplate` + M10 clinical presets + mode registry

- `validateStatusTransition(from, to)` returns `{ ok: bool, error? }`; valid: draft→active, active→on_hold, on_hold→active, completed→invoiced; invalid: invoiced→anything (terminal), discontinued→anything (terminal); unknown from-status returns `{ ok: false }`
- `calculateSessionCompletionPct(plan, sessions)` — `sessions` array or falls back to `plan.sessions_completed`; caps at 100 for denormalization drift
- `listConsentTemplateKeys()` — includes: `general_treatment`, `anaesthesia`, `surgery`, `euthanasia`, `manual_therapy`
- `getConsentTemplate(key)` — returns `{ title, body }` (body >20 chars); returns null for unknown key
- Clinical presets (`dental_clinic`, `veterinary`, `physiotherapy`): all have `business_model: "clinical_treatment"`, `modes` including `treatment_plans` + `appointments`, `dashboard_widgets.active_treatment_plans: true`
- `getClinicalConfig(preset)` — returns `{ chart_preset, subject_type_default, consent_templates }`; dental=`"dental"` chart + `"self"` subject; vet=`"vet_body"` + `"pet"` subject; returns null for non-clinical

---

## `treatment-folio.test.js`

Tests `services/treatment-plan-service.js` folio subsystem — `upsertFolioForPlan`, `recalcFolioTotals`, `resolveNextSessionNumber`, `generatePlanNumber`

- `upsertFolioForPlan(db, planId)` — returns existing open folio without INSERT; creates new folio when none exists; prefers most recent (LIMIT 1 DESC)
- `recalcFolioTotals(db, folioId)` — issues aggregation query + UPDATE; param order: `[sessionTotal, posTotal, taxTotal, grand, folioId]`; `posTotal = pos_total + manual_total`; discounts reduce grand total (negative `line_total` convention)
- `resolveNextSessionNumber(db, planId)` — returns `MAX(session_number) + 1`
- `generatePlanNumber(db)` — format `TP-{YYYY}-{n:4}` zero-padded to 4 digits

---

## `utils-ics.test.js`

Tests `utils/ics.js` — `buildIcsEvent`, `escapeIcsText`, `toIcsUtcStamp`

- `escapeIcsText(str)` — escapes `\`, `;`, `,`, `\n`; normalizes CRLF; handles null/undefined → `""`
- `toIcsUtcStamp(dateOrStr)` — formats as `YYYYMMDDTHHMMSSZ`; accepts ISO string or Date; throws on invalid input
- `buildIcsEvent({ uid, start, end, summary, description?, location?, dtstamp? })` — produces VCALENDAR+VEVENT with CRLF line endings (RFC 5545); omits optional fields when absent; escapes special chars in summary; throws when required fields missing

---

## `schemas-shifts.test.js`

Tests Zod schemas in `schemas/shifts.js` — `OpenShiftSchema`, `CloseShiftSchema`, `VarianceApproveSchema`

- `OpenShiftSchema` — requires `outlet_id`; coerces string numbers; accepts denominations array; rejects negative `opening_float`
- `CloseShiftSchema` — requires `closing_cash`; rejects negative; coerces string; `variance_reason` optional
- `VarianceApproveSchema` — requires `approved_by` as non-empty string; `approval_note` optional

---

## `schemas-sales-payments.test.js`

Tests `PaymentLineSchema`, `CreateSaleSchema` from `schemas/sales.js`

- `PaymentLineSchema` — requires non-empty `method` and non-negative `amount`; coerces amount string; accepts `reference`, `change`, `denomination_breakdown` (passthrough)
- `CreateSaleSchema` — `payments` field is optional (backward compat); validates each payment line; split payments accepted

---

## `printer-service.test.js`

Tests `services/printer.js` — `withRetry`, `openDrawer`, factory behavior

- `withRetry(fn, retries, baseDelayMs)` — `retries=0` means 1 attempt total; exponential backoff; throws last error after exhausting; `retries=2` = 3 total attempts
- `openDrawer()` (via factory) — returns `{ ok: false }` when no printer row; when `is_active: false`; when `cash_drawer: false`; on DB error
- Factory `printerModule(db)` returns service with: `openDrawer`, `printReceipt`, `printerStatus`, `printTest`, `printToNetwork`

---

## `routes-admin-monitoring-infra-cache.test.js`

See above (covered under that section).

---

## `workers-orphan-schema-scan.test.js`

Tests `workers/orphan-schema-scan-worker-boss.js` — `runScan(db)`

- Compares `information_schema.schemata` tenant_* schemas against `public.tenants` slugs
- Returns `{ count, orphans: [{ schema, size }], durationMs }`
- Writes result to `public.infra_cache` with key `"orphaned_schemas"` — admin endpoint reads this cache instead of running the expensive scan inline
- `pg_size_pretty` called per orphan; skipped when zero orphans
- Admin endpoint (`/api/admin/infra`) had ~104s p100 in prod before this was moved to a worker

---

## `pricing-service.test.js`

Tests `services/pricing.js` — `applyPriceBookOverrides`, `composeAutoDiscountPercent`

- `applyPriceBookOverrides(cart, overrides)` — override key format: `"{productId}:{variantId|null}"`; mutates `cart[i].price`; variant-scoped overrides take precedence over product-level; falls back to product-level when no variant match; skips when `item.qty < minQty`; never applies upward overrides; ignores `is_bundle: true` items; uses `original_product_id` when `item.id` has been rewritten
- Returns array of `{ product_id, variant_id, original_price, override_price, quantity }` for applied overrides only
- `composeAutoDiscountPercent({ group, tier, applyGroup?, applyTier? })` — additive stacking (10%+5%=15%); returns `{ pct, breakdown: [{ kind, percent, ... }] }`; caps at 100%; `applyGroup=false` suppresses group entry; ignores `discount_percent: 0`

---

## `inventory-intelligence.test.js`

Tests `services/inventory-intelligence.js` — `assignAbcRanks`, `computeVelocity`, `computeGmroi`, `resolveLeadTime`, `suggestReorderQty`

- `assignAbcRanks(rows)` — classic 80/15/5 Pareto split; stable tie-break by `product_id` ascending; zero-revenue product gets `rank: null`
- `computeVelocity(unitsSold30Days)` — units/day over 30-day window; returns 0 for zero sales
- `computeGmroi(margin, sellThrough, avgInventoryValue)` — returns null when `avgInventoryValue = 0`; `(margin × sellThrough) / avgInventoryValue`
- `resolveLeadTime(product, supplier, tenantDefault)` — priority: product override > supplier default > tenant default > hardcoded 7
- `suggestReorderQty(currentStock, velocity, leadTime, safetyDays)` — returns 0 when stock above threshold; rounds up delta

---

## `anomaly-worker.test.js`

Tests `workers/anomaly-worker-boss.js` — `runAnomalyWorkerForDb({ db })`

- Returns 0 immediately when feature flag `enabled: false` (only 1 DB call)
- Returns 0 when no sales rows
- Skips outlets with fewer than 3 peer employees (peer sample too small to flag)
- Flags outlier when z-score exceeds threshold from `company_settings.anomaly_z_score_threshold` — inserts to `retail_anomaly_flags` with `(employee_id, outlet_id, metric, ..., z_score)`; `metric = "voids_pct"` for void rate, `"refunds_pct"` for refund rate
- Respects caller-supplied z-score threshold override (canned from company_settings row)

---

## `import-mappers.test.js`

Tests `services/import/mappers/` — Shopify mapper, Square mapper, registry

**Shopify** (`shopify.products`, `shopify.customers`):
- `shopify.products(rows)` — maps `Title`, `Variant SKU`, `Variant Price` (strips `$`), `Cost per item`, `Variant Inventory Qty`; appends variant option when non-default (`"Shirt - Large"`); strips `"Default Title"`; `"draft"` status → `"inactive"`; skips rows with no Title; `selling_price: ""` when price missing
- `shopify.customers(rows)` — joins first+last name; joins address parts; tags → `occupation`

**Square** (`square.products`, `square.customers`):
- `square.products(rows)` — picks first non-empty `Current Quantity {location}` column; uses `Reporting Category` as `brand`
- `square.customers(rows)` — `Surname` field for last name; falls back to `Company Name` when no first/last; `Reference ID` → `cnic`; `Group Names` → `occupation`

**Registry** (`getMapper`, `getTemplate`, `listSources`):
- `getMapper("shopify", "products")` → function; returns null for unknown source or entity
- `getTemplate("shopify", "products")` → `{ headers, examples }`; null for unsupported pair
- `listSources()` includes `"shopify"`, `"square"`

---

## `retail-flag-preset.test.js`

Tests `services/retail-flag-preset.js` — `RETAIL_SEED_FLAGS`, `MULTI_OUTLET_SEED_FLAGS`, `seedRetailFlags`, `seedMultiOutletFlags`

- `RETAIL_SEED_FLAGS` has exactly **19** entries; includes `phase5_cod_reconciliation`, `phase5_shipping_automation`, `phase5_sms_providers`, `sms_campaigns`
- `MULTI_OUTLET_SEED_FLAGS` has exactly **5** entries; does NOT include `kiosk_context_locked`
- `seedRetailFlags(client)` — issues one `INSERT INTO feature_flags ... ON CONFLICT (key) DO UPDATE SET enabled = true` per flag
- `seedMultiOutletFlags(client)` — same pattern for 5 multi-outlet flags

---

## `dockerfile-pg-dump.test.js`

Tests `backend/Dockerfile` (reads the file directly via `fs.readFileSync`)

- `apk add` line in the production stage (last `FROM`) must include `postgresql-client` or `postgresql{N}-client`
- Regression guard: `pg_dump` must be on PATH in the deployed container for `/api/admin/backup` and `/api/backup/download` to work (R2 had 0 backup objects for 50+ days pre-fix)

---

## `tenant-auth-employee-email.test.js`

Tests P28 fix: `loadTenantAndPerms` must `SELECT email` from employees and assign to `req.employee.email`

- Pre-fix: only `(role_id, name)` SELECTed → `req.employee.email` was undefined → `routes/support.js` silently skipped support confirmation emails for all tenants
- Post-fix assertion: `req.employee.email === "oneshop349@gmail.com"` after successful auth
- Uses require.cache eviction pattern to get fresh middleware state
