# Middleware — Claude Guide

Only `tenant-auth.js` and `feature-flags.js` expose `init(deps)` — every other middleware file exports plain functions or factories that need no boot-time wiring. Middleware chain order (employee/tenant path) is documented in `backend/CLAUDE.md`.

---

## request-id.js

**Exports:** default function `requestId`, named `requestId.enrichReqLog`

- Wraps `pino-http` (backed by the shared `services/logger.js` instance — never construct a second Pino logger).
- Generates a UUID per request via `crypto.randomUUID()`, or honours an incoming `X-Request-Id` header.
- Sets `X-Request-Id` on the response.
- Attaches `req.log` (Pino child logger), `req.id`, `req._startTime = Date.now()`.
- Log level: `error` for 5xx or a thrown error, `warn` for 4xx or duration > 2000ms (`SLOW_REQUEST_MS`), `info` otherwise.
- Serializers are deliberately minimal (method/url/remoteAddress, statusCode) — no request/response bodies logged.

**`enrichReqLog(req, res, next)`** — wire AFTER `loadTenantAndPerms`. Re-binds `req.log` as a child logger with `{ tenantSlug, employeeId }` once those fields exist on `req`. No-op if `req.log` is absent or neither field is set yet.

**`req.*` set:** `req.log`, `req.id`, `req._startTime`

**Env vars:** none directly.

**Mount point:** first in the chain, before tenant/auth middleware — every request (including admin/webhook routes) gets a request ID and logger regardless of auth outcome.

---

## tenant-auth.js

**Exports:** `init(deps)`, `loadEmployeePerms`, `loadTenantAndPerms`, `resolveTenant`, `loadCompanyProfile`, `resolveContext`, `invalidateCompanyProfileCache`

`init(deps)` requires `{ db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore }`. It also calls an internal `_warmCaches()` for single-tenant mode — eagerly loads the company profile and the `context_header_enforced` flag at boot, and prints a `SETUP URL` console banner if setup isn't complete yet.

Two per-tenant in-memory caches, both keyed by `req.tenantId` (or `"_default"` in ST mode):
- Company profile cache — `COMPANY_CACHE_MS = 5 * 60 * 1000` (5 min)
- Context-enforcement flag cache — `CONTEXT_FLAG_CACHE_MS = 30000` (30s) — separate from `feature-flags.js`'s own 60s cache

### `loadEmployeePerms(req, res, next)`
Header-based fallback path, no JWT involved. Reads `x-employee-id` header, validates it's an integer in `(0, 999999]` → 400 `{ error: "Invalid employee ID header" }` if malformed. Queries `employees` + `role_permissions` directly against the plain `db` handle (not tenant-proxied — single-tenant assumption). Sets `req.employeePerms = []` on missing employee or any thrown error. Does **not** set `req.employee` or `req.tenantId`.

### `loadTenantAndPerms(req, res, next)`
Primary JWT auth middleware. Reads `Authorization: Bearer <token>`, verifies via `jwt-auth.js:verifyAccessToken(token, process.env.JWT_SECRET)`.

**Sets on `req`:**
- `req.tenantId` — from `decoded.tid`
- `req.employee` — `{ id, role_id, name, email }` (name/email backfilled after the permission lookup)
- `req.employeePerms` — array of permission strings
- `req.tokenScope` — `"full"` (default) or `"kiosk"`
- `req.isImpersonating` — boolean; `req.impersonatedBy` only set when true
- `req.context.outletId` — from the JWT's `oid` claim, if present; also backfills `req.headers["x-outlet-id"]` if the header is absent
- `req.headers["x-employee-id"]` — backfilled from `decoded.eid` as a compatibility bridge for code still reading the header directly

**Behavior:**
- No `Authorization` header at all → `req.employeePerms = []`, calls `next()` without rejecting. Many routes rely on this to allow unauthenticated fall-through (their own `requirePerm` guard is what actually blocks them).
- Kiosk scope (`decoded.scope === "kiosk"`) is restricted to `KIOSK_ALLOWED_PATHS` — `/^\/api\/attendance\/pin-/` and `/^\/api\/auth\//`. Anything else → 403 `{ code: "KIOSK_RESTRICTED" }`.
- Token revocation: checks `revoked_tokens` by `token_jti`, then (for impersonation tokens specifically) cross-checks `public.impersonation_sessions.revoked_at` — belt-and-suspenders because the revoked_tokens insert on impersonation-end is best-effort and can silently fail. Also checks `employees.tokens_revoked_before` against `decoded.iat`. Missing table/column errors here are swallowed (pre-migration tolerance), not surfaced as failures.
- The permission lookup (`role_id` → `role_permissions`) runs against the **tenant-scoped** DB (`tenantDbManager.getDb(decoded.tid)` in MT mode) and retries once after a 100ms delay on a transient failure. If both attempts fail → 503 `{ code: "PERM_LOAD_FAILED" }` — deliberately not a silent empty-perms fallback, which used to masquerade as a misleading 403 for Admin users under pool pressure.
- Impersonation appends `" (impersonated by Super-Admin)"` to `req.employee.name`.
- JWT decode errors: `TokenExpiredError` → 401 `{ code: "TOKEN_EXPIRED" }`; `JsonWebTokenError` / `NotBeforeError` → 401 `{ code: "INVALID_TOKEN" }`; any other unexpected error → 401 `{ code: "AUTH_FAILED" }` (logged via `req.log`/console, not silently passed through — a silent fall-through here used to surface downstream as a 500 from the tenant DB proxy having no async context).

### `resolveTenant(req, res, next)`
No-op in single-tenant mode. In MT mode:
- Resolves a tenant ID from `req.tenantId` (set by `loadTenantAndPerts`), OR from `?tenant=<slug>` — but ONLY if the request path matches `PUBLIC_TENANT_PARAM_PATHS`: `/api/auth/*`, `/api/attendance/pin-*`, `/api/feature-flags*`, `/api/setup/*`, `/api/health*`, `/api/company-profile/currency` (exact), `/api/billing/pricing` (exact). This allowlist exists specifically so an unauthenticated caller can't attach a tenant DB scope to any route lacking its own permission guard just by appending `?tenant=foo`.
- If no tenant ID resolves and the path starts with `/api/` and isn't on the allowlist → 401 `{ code: "AUTH_REQUIRED" }` (a clean, intentional failure instead of letting the request crash later at the tenant DB proxy with "no tenant DB in async context").
- Otherwise calls `tenantDbManager.getDb(tenantId)`, looks up the tenant row via `master-db-pg.js:getTenantById`, and runs `asyncStore.run({ db: tenantDb }, () => next())` — this is what wires the AsyncLocalStorage context so `deps.db` (the proxy in `tenant-db-proxy-pg.js`) routes queries to the right tenant schema for the rest of the request.
- Sets `req.tenantSlug` and `req.tenantDir` (a local path under `backend/tenants/t_<slug>`, used by `tenant-multer.js`).
- Error codes: `TENANT_NOT_FOUND` (403, tenant row missing), `TENANT_SUSPENDED` (403, error message contains "is suspended"), `TENANT_DELETED` (403, message contains "is deleted"), otherwise 500 on any other lookup failure.

### `loadCompanyProfile(req, res, next)`
- Reads `SELECT * FROM company_profile WHERE id = 1` via `_getCompanyDb(req)` — picks the ALS-proxied `dbProxy` in MT mode (only when `req.tenantId` is set) or the plain `db` in ST mode.
- Cold start (no cache entry yet): sets a `_placeholder` entry synchronously (`{ timezone: "UTC" }`) and **awaits** the very first DB load inline. This avoids a race where the post-signup-wizard auto-login (or the first request after a restart) hits the placeholder before the real row loads and gets wrongly bounced with `SETUP_REQUIRED`.
- Warm entries refresh stale-while-revalidate: once the 5-minute TTL expires, the cache is refreshed fire-and-forget while the stale value is served immediately.
- Sets `req.company` to the full row (timezone, currency, FBR config, `setup_complete`, etc.).
- If the loaded (non-placeholder) profile has a falsy `setup_complete`, and the path isn't `/api/setup*` or `/api/health*`, and (in MT mode) `req.tenantId` is set → 503 `{ code: "SETUP_REQUIRED" }`.
- `invalidateCompanyProfileCache(tenantIdOrSlug)` — call after setup-complete or profile edits so the next request re-reads instead of serving a stale cached row. Pass nothing/`null` to clear the entire cache.

### `resolveContext(req, res, next)`
- Reads `x-company-id`, `x-outlet-id`, `x-scope-mode` headers into `req.context = { companyId, outletId, scopeMode }` (each `null` if the header is absent). Note this **overwrites** `req.context` set earlier in `loadTenantAndPerms` — but since that earlier step also backfills the `x-outlet-id` header itself from the JWT's `oid` claim, the effective outlet value survives.
- Checks the `context_header_enforced` feature flag using its own small cache (`CONTEXT_FLAG_CACHE_MS`, 30s — independent of `feature-flags.js`'s cache).
- When enforced and the path is under `/api/`: paths matching `CONTEXT_EXEMPT_PATHS` (`/api/auth/*`, `/api/context/*`, `/api/feature-flags*`, `/api/attendance/pin-*`, `/api/roles/:id/permissions`, `/api/outlets` exact) skip the check entirely. A request with no `x-employee-id` header passes through silently (relies on downstream auth to reject it). A non-admin employee (no `all_access` permission) without `x-outlet-id` set → 428 `{ code: "CONTEXT_REQUIRED" }`.

**`req.*` set across the full chain:** `req.tenantId`, `req.tenantSlug`, `req.tenantDir`, `req.employee`, `req.employeePerms`, `req.tokenScope`, `req.isImpersonating`, `req.impersonatedBy`, `req.company`, `req.context`

**Env vars:** `JWT_SECRET`, `MULTI_TENANT` (via `IS_MULTI_TENANT` passed into `init`)

**Mount order:** `loadTenantAndPerms` → `resolveTenant` → (tenant `/uploads` static) → `loadCompanyProfile` → `resolveContext`. Every tenant-scoped route mounts after this chain completes.

---

## permissions.js

**Exports:** `requirePerm`, `requireAnyPerm`, `requireContextOutlet`, `DEFAULT_ROLE_PERMISSIONS`, `ensureDefaultRolePermissions`, `PERMISSION_RULES`

### `requirePerm(permission)`
Returns middleware. Checks `req.employeePerms` (array, defaults to `[]`). `"all_access"` bypasses everything. 403 `{ error: "Forbidden: insufficient permissions" }` on failure.

### `requireAnyPerm(permissions[])`
Same shape but takes an array — passes if the employee has `all_access` OR any one of the listed permissions.

### `requireContextOutlet(req, res, next)`
If `req.context?.outletId` is set and `req.query.outlet_id` is absent, backfills `req.query.outlet_id` from context. Always calls `next()` — never blocks.

### `DEFAULT_ROLE_PERMISSIONS`
- `Administrator`: `["all_access"]`
- `Manager`: a broad set — `manage_inventory`, `manage_orders`, `view_reports`, `manage_employees`, `pos_discount`, `void_sales`, `pos_park`, `pos_void`, `manage_restaurant`, `manage_kds`, `manage_bookings`, `manage_projects`, `manage_contracts`, `manage_tickets`, `manage_rentals`, `manage_rooms`, `manage_treatment_plans`, `manage_tips`, `override_void_comp`, `manage_gift_cards`, `override_price`, `override_credit_limit`, `manage_field_sales`, `manage_forms`
- `Cashier`: `["view_reports", "pos_discount", "pos_park"]`
- `"Field Rep"`: `["manage_field_sales"]` only — the minimal role for the wholesale mobile order-booker/DSR app; scoping to "only their own route/check-ins" is enforced in the route handlers, not here.

### `ensureDefaultRolePermissions(db)`
Async. Looks up the `roles` table, and for each role name present in `DEFAULT_ROLE_PERMISSIONS`, inserts each permission via `INSERT ... ON CONFLICT DO NOTHING`. Idempotent — safe to call repeatedly (tenant provisioning, role backfills). Logs and swallows errors rather than throwing.

### `PERMISSION_RULES`
A declarative array of `{ methods: [...], path: /regex/, anyPerms: [...] }` entries covering common route-level guards — reports, attendance, categories/brands/products/attribute-sets/barcode templates/expenses, outlets, receipt templates, suppliers/supplier-returns/supplier-invoices, returns, approvals, PO/transfer submit+approve, parked sales, and each Phase-4 vertical (restaurant, KDS, bookings/appointments, projects, contracts, service tickets, rentals, room management, treatment plans + clinical sub-resources, tips). This is a reference table consumed by tests / documentation — it is **not** auto-applied to routes; each route still calls `requirePerm`/`requireAnyPerm` directly in its handler chain.

**`req.*` read:** `req.employeePerms`, `req.context`

---

## feature-flags.js

**Exports:** `init(deps)`, `DEFAULT_FEATURE_FLAGS`, `getFeatureFlagsMap`, `getModesMap`, `invalidateFeatureFlagCache`, `invalidateModeCache`, `requireFeature`, `requireMode`, `createNotification`, `notifyLowStockForSale`

`init(deps)` requires `{ db, IS_MULTI_TENANT, tenantDbManager, dbProxy }`; also derives `_notifDb = IS_MULTI_TENANT ? dbProxy : db` for the notification helpers.

### `DEFAULT_FEATURE_FLAGS`
A large static map of `flagKey: boolean` covering the core spine (accounting, approvals, notifications, CRM/quotations, HR, multi-company — mostly `true` by default) and every vertical/tier addition since (reports enhancements, Phase-2 outlet/pricing/collections features, marketing/messaging/invoicing, AI insights, subscriptions, restaurant, appointments, packages/passes, gym check-in, service projects/contracts, workflow tickets, rentals, room management, treatment plans/clinical, form builder, Phase-5 Pakistan shipping/COD/payment/SMS integrations, Phase-2-G general-retail parity features, wholesale credit/field-sales/schemes/secondary-sales/backorders/van-sales, kit/BOM engine, batch/expiry tracking). Most vertical-specific flags default `false` and are flipped on per-tenant by the setup wizard or a migration backfill matching the tenant's chosen preset/mode — they are deliberately **not** globally true. A handful of additive, backward-safe UI flags (e.g. `receipt_designer_v2`) default `true`.

**Known drift points** (check the live map before assuming a flag's default):
- `fbr_integration` is **not** in this map at all — it's DB-seeded by a dedicated migration, so a brand-new tenant row is what determines its state, not this file.
- `ai_insights` defaults `true` here but the `routes/insights-ai.js` route reads the DB row directly as a soft gate rather than calling `requireFeature()` — this file's default only affects what the admin flags editor shows before the DB row exists.
- Shopify routes gate on an active-connection check, not a feature flag at all.

### `getFeatureFlagsMap(tenantId)`
Async. 60s in-memory cache per tenant (`FEATURE_FLAG_CACHE_MS`), keyed by `tenantId` or `"_default"`. Merges `DEFAULT_FEATURE_FLAGS` with rows from the tenant's `feature_flags` table — a DB row's `enabled` value always overrides the default. In MT mode, queries via `tenantDbManager.getDb(tenantId)`; falls back to plain `db` if that lookup throws. If the `feature_flags` table itself doesn't exist yet, returns the default map unmodified rather than throwing.

### `requireFeature(flagKey)`
Returns async middleware. 403 `{ error: "Feature disabled: <key>", flag: <key> }` if the flag resolves false — intentionally 403, not 503: "feature off" is a permission-style refusal, not a service outage, and 503 was triggering alerting noise on routine POS capability probes. 500 on any unexpected DB error.

### `getModesMap(tenantId)`
Async. Same 60s-cache pattern (`MODE_CACHE_MS`) against the `tenant_modes` table. Returns `{}` (not an error) if `init()` was never called — some test harnesses build an app without wiring feature-flags deps — or if the table doesn't exist yet, so `requireMode` can fall through to its back-compat branch below instead of 500ing.

### `requireMode(modeName)`
Returns async middleware. If the resolved mode map is **empty** (pre-migration, or a tenant with no `tenant_modes` rows at all), falls through via `next()` — feature flags alone are the gate in that case (back-compat). Otherwise 403 `{ error: "Mode not enabled: <name>", mode: <name> }` if the named mode is off or missing from the map.

### `invalidateFeatureFlagCache(tenantId)` / `invalidateModeCache(tenantId)`
Bust the respective cache for one tenant, or the whole cache if `tenantId` is falsy. Call after any admin flag/mode mutation.

### `createNotification(type, title, message, link)`
Fire-and-forget `INSERT INTO notifications`. Errors silently swallowed (`.catch(() => {})`).

### `notifyLowStockForSale(cartItems, outletId)`
Dedupes product IDs out of cart line items (checks `original_product_id`, `product_id`, `id` in that order), queries `outlet_stock` joined to `products` for rows with quantity ≤ 10, and calls `createNotification("low_stock", ...)` per match. No-ops if `outletId` or the product list is empty. Fire-and-forget.

**`req.*` read:** `req.tenantId`

**Env vars:** none directly — `IS_MULTI_TENANT` and the DB handles are injected via `init(deps)`, not read from `process.env` in this file.

---

## plan-limits.js

**Exports:** `requirePlanLimit`, `requireActiveSubscription`, `PLAN_DEFAULTS`

### `requirePlanLimit(resource)`
`resource` must be `"employees"`, `"outlets"`, or `"products"` — an unrecognized value throws synchronously at middleware-construction time (i.e. at route-registration time, not per-request).

Returns async middleware:
- No-op when `MULTI_TENANT !== "1"`.
- No-op if `req.tenantId` is absent — lets downstream auth handle the real rejection.
- Reads `max_<resource>` off the `public.tenants` row via `master-db-pg.js`. `null` or `<= 0` means unlimited → passes through.
- Counts current rows through the tenant-scoped DB (`tenant-db-manager-pg.js:getDb`). Employees and products exclude `deleted_at IS NOT NULL` rows; outlets excludes rows where `outlet_type = 'van'` (vans are wholesale rep-stock buckets gated behind `wholesale_van_sales`, not sellable locations, so they're exempt from the plan cap by design — `COALESCE(outlet_type, 'store')` keeps legacy NULL rows counting as stores).
- At or over the limit → 403 `{ error, code: "PLAN_LIMIT_REACHED", limit, current }`.
- Any lookup failure (DB error, missing tenant row) → best-effort `next()` — never blocks a request purely because the limit check itself failed.

### `requireActiveSubscription(req, res, next)`
Synchronous function body; the actual DB check runs via `.then()`/`.catch()`, not `await` — the outer function returns before that promise resolves. Express still handles the eventual response fine, but don't wrap a call site in try/catch expecting a thrown error from this function.
- No-op for `GET`/`OPTIONS`/`HEAD` requests, ST mode, and paths under `/api/auth/`, `/api/billing/`, `/api/support/`, `/api/setup/`, `/api/health`, `/api/receipts/` — these must keep working regardless of subscription state.
- No-op if `req.tenantId` is absent.
- Free-plan tenants (`plan === "free"`) are **never** blocked, even if `payment_status` has drifted to something unexpected.
- `payment_status === "expired"` → 403 `{ error, code: "SUBSCRIPTION_EXPIRED", billing_url: "/billing" }`.
- Lookup failure → best-effort `next()`.

### `PLAN_DEFAULTS`
```js
{
  free: { max_outlets: 1, max_employees: 3, max_products: 100 },
  pro:  { max_outlets: 1, max_employees: 0, max_products: 0 },
}
```
`0` means unlimited. These are the values applied at tenant provisioning / plan change — the middleware itself always reads the tenant row's own columns live, not this constant.

**`req.*` read:** `req.tenantId`, `req.method`, `req.path`

**Env vars:** `MULTI_TENANT`

---

## rate-limit.js

All limiters are `express-rate-limit` instances sharing one `limitExceededHandler` → 429 with a `Retry-After` header (seconds) and body `{ error: "Too many requests", retry_after_seconds }`.

**Exports:** `globalLimiter`, `authLimiter`, `webhookLimiter`, `reviewLimiter`, `publicBookingLimiter`, `publicRestaurantLimiter`, `memberKioskLimiter`, `customerPortalAuthLimiter`, `customerPortalOtpLimiter`, `customerPortalDataLimiter`, `manufacturerPortalAuthLimiter`, `manufacturerPortalDataLimiter`, `pinValidateLimiter`, `adminTotpLimiter`

| Limiter | Window | Max | Key | Test skip |
|---|---|---|---|---|
| `globalLimiter` | `RATE_LIMIT_WINDOW_MS` (default 60s) | `RATE_LIMIT_GLOBAL_MAX` (default 600) | `{tenantSlugOrSt}:{ip}` | n/a — `skip` exempts POS burst paths instead |
| `authLimiter` | 15 min | `RATE_LIMIT_AUTH_MAX` (default 20) | `{store_code or tenant slug}:{ip}` (ST mode: `req.ip` only) | yes |
| `webhookLimiter` | 60s | `RATE_LIMIT_WEBHOOK_MAX` (default 120) | default keyGenerator (IP) | no |
| `reviewLimiter` | 15 min | 5 | `review:{tenant}:{ip}` | yes |
| `publicBookingLimiter` | 15 min | 10 | `pubbook:{tenant}:{ip}` | yes |
| `publicRestaurantLimiter` | 60s | 60 | `pubrest:{tenant}:{ip}` | yes |
| `memberKioskLimiter` | 60s | `RATE_LIMIT_MEMBER_KIOSK_MAX` (default 30) | `memberkiosk:{tenant}:{ip}` | yes |
| `customerPortalAuthLimiter` | 15 min | 10 | `portal-auth:{slug}:{ip}` | yes |
| `customerPortalOtpLimiter` | 15 min | 5 | `portal-otp:{email}:{ip}` | yes |
| `customerPortalDataLimiter` | 60s | 120 | `portal-data:{customerId}` else `portal-data:{slug}:{ip}` | yes |
| `manufacturerPortalAuthLimiter` | 15 min | 5 | `mfg-portal-auth:{slug}:{ip}` | yes |
| `manufacturerPortalDataLimiter` | 60s | 60 | `mfg-portal-data:{manufacturerId}` else `mfg-portal-data:{slug}:{ip}` | yes |
| `pinValidateLimiter` | 15 min | 20 | `pin-validate:{tenant}:{ip}` | yes |
| `adminTotpLimiter` | 15 min | 5 | `admin-totp:{ip}` | yes |

**`globalLimiter` skips** (`isPosBurstPath`): `/api/sales`, `/api/products/search`, `/api/products/scan/`, `/api/orders` — POS hot paths that would otherwise blow through the global cap during normal cashier usage.

**`pinValidateLimiter`** exists because the PIN-validate endpoint reveals "is this PIN any employee's PIN" — a 4-digit space is brute-forceable inside the global 600/min limit in roughly 17 minutes; 20/15m forces the search out to years.

**`adminTotpLimiter`** guards the super-admin second-factor step specifically (each attempt is a 6-digit code or recovery-code guess) — deliberately the tightest limiter in the file since it's the last gate before a super-admin session token is issued.

**Env vars:** `MULTI_TENANT`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_WEBHOOK_MAX`, `RATE_LIMIT_MEMBER_KIOSK_MAX`, `NODE_ENV` (most non-global/auth limiters skip enforcement entirely when `NODE_ENV === 'test'`)

**Gotcha:** the portal limiters (customer + manufacturer), plus review/booking/restaurant/kiosk limiters, all key on the `?tenant=` query param or `x-tenant-slug` header rather than `req.tenantSlug` — because they sit on routes mounted **before** `loadTenantAndPerms`/`resolveTenant` run, so `req.tenantSlug` isn't set at that point in the chain.

---

## validate.js

**Exports:** `{ validate }`

### `validate(schema)`
Factory. Returns Express middleware that calls `schema.parse(req.body || {})`.
- On success, **replaces** `req.body` with the parsed (coerced/stripped) result — downstream handlers must never assume the raw request body shape survives.
- On `ZodError` → 400 `{ error: "<first issue message>", details: [{ field, message }] }`. `field` is the dot-joined issue path (e.g. `"items.0.price"`). Reads `err.issues` (current Zod) with a fallback to `err.errors` (older Zod) via `??`.
- Any non-Zod error is forwarded to `next(err)` rather than swallowed.

Schemas live in `backend/schemas/` — route files should never define Zod schemas inline.

---

## upload-validation.js

**Exports:** `imageFileFilter`, `rasterImageFileFilter`, `clinicalDocFileFilter`, `safeExtension`, `detectImageType`, `verifyImageMagicBytes`, `ALLOWED_IMAGE_MIMES`, `ALLOWED_IMAGE_EXTS`, `ALLOWED_RASTER_IMAGE_MIMES`, `ALLOWED_RASTER_IMAGE_EXTS`, `ALLOWED_CLINICAL_DOC_MIMES`, `ALLOWED_CLINICAL_DOC_EXTS`

Built on a shared factory, `makeImageFileFilter(allowedMimes, allowedExts)`, which checks both `file.mimetype` and `path.extname(file.originalname)` against allowlists — used as a multer `fileFilter`.

### `imageFileFilter`
Full allowlist including SVG: JPEG, PNG, GIF, WebP, SVG, BMP, TIFF. Use **only** for uploads that get rasterized (e.g. via `sharp`) before being served back out — product images are the canonical case.

### `rasterImageFileFilter`
Same set minus SVG. Use for anything stored as-is and served from a same-origin URL — an SVG can carry `<script>`/`onload` payloads that execute when fetched as a top-level document with the API's auth cookies attached. Support-ticket screenshot uploads use this filter.

### `clinicalDocFileFilter`
Raster images + `application/pdf` + `text/plain`, no SVG. For treatment-plan clinical document uploads (lab reports, referrals, imaging) that need non-image formats but must still exclude anything that could execute same-origin.

### `detectImageType(buffer)`
Magic-byte sniffer for JPEG, PNG, GIF, WebP, BMP, TIFF (both endiannesses), and PDF. Returns `null` if the bytes don't match any known signature. No SVG/plain-text detection possible (no magic bytes to sniff).

### `verifyImageMagicBytes(buffer, claimedMime)`
Returns `true`/`false` comparing `detectImageType(buffer)` against the claimed MIME. `text/plain` always passes (nothing to sniff — relies entirely on the fileFilter allowlist + extension check). Call this **after** multer accepts a file, to catch a faked `Content-Type` — e.g. an executable renamed to `.jpg` with a spoofed `image/jpeg` header.

### `safeExtension(originalname, mimetype)`
Returns the original extension if it's in `ALLOWED_IMAGE_EXTS`; otherwise derives one from the MIME type; otherwise defaults to `.png`.

**No env vars.**

---

## customer-auth.js

Customer portal JWT auth. Mounted **before** the employee tenant middleware chain, so `req.employee`/`req.company` are never set on portal requests; tenant DB routing goes through `services/public-tenant-context.js:resolvePublicTenantDb()` instead of `resolveTenant`.

**Exports:** `loadCustomerAuth(deps)`, `signCustomerTokens(customer, tenant)`, `verifyCustomerToken(token)`, `hashRefreshToken(token)`, `getSecret()`

### `loadCustomerAuth(deps)`
Factory — returns async `customerAuth(req, res, next)`.
- Reads `Authorization: Bearer <token>` → 401 `"Missing bearer token"` if absent/malformed.
- Verifies with `getSecret()` → 401 `"Invalid or expired token"` on any verify failure.
- Rejects (401) if `payload.scope !== "customer"` (blocks staff/manufacturer tokens from cross-authing) or `payload.type === "refresh"` (a refresh token can never be used as an access token).
- Calls `resolvePublicTenantDb(req, deps)` — that resolver reads the tenant from `?tenant=` or `x-tenant-slug`. This handler then cross-checks `payload.tid` against the resolved tenant's ID, so a valid token for tenant A can't be replayed against tenant B's slug.
- Looks up `customers.portal_tokens_revoked_before` — 401 `"Session revoked"` if the token's `iat` predates that cursor (set on password reset / logout-all). Also 401s if the customer row is missing or soft-deleted (`deleted_at IS NOT NULL`).

**Sets on `req`:** `req.customerId`, `req.tenantId`, `req.tenant` (`{ id, slug }`), `req.db` (tenant-scoped, returned directly by the resolver — **not** the standard ALS-proxied `deps.db`).

### `signCustomerTokens(customer, tenant)`
Returns `{ accessToken, refreshToken, refreshHash, refreshExpiresAt }`. Both tokens carry `{ cid, tid, tslug, scope: "customer", jti }` (refresh additionally has `type: "refresh"`). `refreshHash` (SHA-256 of the raw token) is what gets persisted to the DB — the raw refresh token is never stored.

### `getSecret()` / `verifyCustomerToken(token)` / `hashRefreshToken(token)`
`getSecret()` returns `CUSTOMER_PORTAL_JWT_SECRET`, falling back to `JWT_SECRET` (logs a one-time `[SECURITY]` console warning on first fallback), falling back to the hardcoded `"dev-insecure-secret"` if neither is set.

**Env vars:** `CUSTOMER_PORTAL_JWT_SECRET`, `JWT_SECRET` (fallback), `CUSTOMER_PORTAL_ACCESS_TTL` (default `"30m"`), `CUSTOMER_PORTAL_REFRESH_TTL` (default `"30d"`)

---

## manufacturer-auth.js

Manufacturer partner portal JWT auth. Structurally near-identical to `customer-auth.js` — separate secret, separate scope, separate table — and mounted before the employee tenant middleware chain, also via `resolvePublicTenantDb()`.

**Exports:** `loadManufacturerAuth(deps)`, `signManufacturerTokens(partner, tenant)`, `verifyManufacturerToken(token)`, `hashRefreshToken(token)`, `getSecret()`

### `loadManufacturerAuth(deps)`
Factory — returns async `manufacturerAuth(req, res, next)`. Mirrors `loadCustomerAuth`'s structure:
- Bearer token required; `payload.scope` must be `"manufacturer"`; refresh tokens rejected as access tokens.
- `resolvePublicTenantDb()` + the same cross-tenant `tid` check as the customer portal.
- Looks up `manufacturer_partners` by `payload.mid` — additionally gates on partner `status`: `"suspended"` → 403 `"Partner access suspended"`; anything other than `"active"` → 401 `"Partner not active"`; missing row → 401 `"Manufacturer partner not found"`.
- Honors `portal_tokens_revoked_before` the same way as the customer portal.

**Sets on `req`:** `req.manufacturerId`, `req.tenantId`, `req.tenant`, `req.db`.

### `signManufacturerTokens(partner, tenant)`
Same structure as `signCustomerTokens`, but the payload key is `mid` (not `cid`) and `scope: "manufacturer"`.

**Env vars:** `MANUFACTURER_PORTAL_JWT_SECRET` (falls back to `JWT_SECRET`), `MANUFACTURER_PORTAL_ACCESS_TTL` (default `"15m"` — deliberately shorter than the customer portal's 30m, since manufacturer reports expose aggregate revenue/scheme data, considered more sensitive), `MANUFACTURER_PORTAL_REFRESH_TTL` (default `"30d"`)

**Gotcha:** `customer-auth.js` and `manufacturer-auth.js` share the same token shape (principal id + `tid` + `tslug` + `scope` + `jti`), the same `resolvePublicTenantDb()` cross-tenant check, and the same revocation-cursor pattern — but they've drifted apart on TTL defaults and status-check details (only the manufacturer variant checks a `status` column). If you fix a bug in one — especially anything touching the `?tenant=` cross-tenant lockdown or revocation logic — check whether the same bug exists in the other.

---

## Application order (full picture)

```
requestId                          ← first, gives every request req.log + req.id
globalLimiter                      ← before route mounting

[admin routes (routes/admin/) mount here — no tenant context]
[webhook routes (routes/webhooks.js) mount here — no auth except HMAC on /api/webhooks/xpay]
[customer portal routes: customerPortalAuthLimiter/customerPortalOtpLimiter/customerPortalDataLimiter → loadCustomerAuth(deps) → handler]
[manufacturer portal routes: manufacturerPortalAuthLimiter/manufacturerPortalDataLimiter → loadManufacturerAuth(deps) → handler]

authLimiter                        ← applied to /api/auth/* routes specifically
loadTenantAndPerms                 ← req.employee, req.employeePerms, req.tenantId, req.tokenScope
enrichReqLog                       ← (request-id.js) re-binds req.log with tenant/employee, optional
resolveTenant                      ← req.tenantSlug, asyncStore context wired, deps.db proxy now live
[tenant /uploads static]
loadCompanyProfile                 ← req.company (needs resolveTenant's tenant context in MT)
resolveContext                     ← req.context (reads headers + context_header_enforced flag)

[all tenant business routes mount here]

requirePerm / requireAnyPerm       ← per-route
requireFeature / requireMode       ← per-route
validate(schema)                   ← per-route body validation
requirePlanLimit(resource)         ← per-route, POST/creation endpoints only
requireActiveSubscription          ← per-route or globally on write verbs
```

**Portal routes (customer + manufacturer) are structurally separate chains** — they never pass through `loadTenantAndPerms`/`resolveTenant`/`loadCompanyProfile`/`resolveContext`. Don't assume `req.employee`, `req.company`, or the ALS-proxied `deps.db` are available in portal route handlers; use `req.db` (set directly by the portal auth middleware) instead.
