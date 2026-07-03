# Middleware — Claude Guide

Only `tenant-auth.js` and `feature-flags.js` expose `init(deps)` — all other middleware files export plain functions or factories. Middleware chain order (employee/tenant path) is documented in `backend/CLAUDE.md`.

---

## request-id.js

**Exports:** default function `requestId`, named `requestId.enrichReqLog`

- Wraps `pino-http`. Generates a UUID per request or honours the incoming `X-Request-Id` header.
- Sets `X-Request-Id` response header.
- Attaches `req.log` (Pino child logger), `req.id`, `req._startTime = Date.now()`.
- Log level: `error` for 5xx or thrown error, `warn` for 4xx or duration >2000ms, `info` otherwise.
- Serializers are minimal — no full request/response bodies.

**`enrichReqLog(req, res, next)`** — wire AFTER `loadTenantAndPerms`. Re-binds `req.log` as a child with `{ tenantSlug, employeeId }` once those are available. Safe no-op if `req.log` is absent.

**`req.*` set:** `req.log`, `req.id`, `req._startTime`

**Env vars:** none directly (reads defaults from the shared `services/logger.js` Pino instance).

**Mount point:** near the top of the chain, before tenant/auth middleware, so every request (including admin/webhook routes) gets a request ID and logger.

---

## tenant-auth.js

**Exports:** `init(deps)`, `loadEmployeePerms`, `loadTenantAndPerms`, `resolveTenant`, `loadCompanyProfile`, `resolveContext`, `invalidateCompanyProfileCache`

**Requires `init(deps)`** at boot with `{ db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore }`. `init()` also calls `_warmCaches()` internally for single-tenant mode (pre-loads company profile + context flag, prints a setup URL to console if setup is incomplete).

### `loadEmployeePerms(req, res, next)`
Header-based only (no JWT) — legacy/secondary path. Reads `x-employee-id` header, validates range (1–999999) → 400 if malformed. Queries `employees` + `role_permissions` directly against `db` (not tenant-proxied). Sets `req.employeePerms = []` on missing employee or any error. Does **not** set `req.employee` or `req.tenantId`.

### `loadTenantAndPerms(req, res, next)`
Primary JWT auth middleware. Reads `Authorization: Bearer <token>`, verifies via `jwt-auth.js:verifyAccessToken`.

**Sets on `req`:**
- `req.tenantId` — from `decoded.tid`
- `req.employee` — `{ id, role_id, name, email }`
- `req.employeePerms` — array of permission strings
- `req.tokenScope` — `"full"` (default) or `"kiosk"`
- `req.isImpersonating` — boolean; `req.impersonatedBy` set only when true
- `req.context.outletId` — from `decoded.oid` JWT claim (if present); also backfills `x-outlet-id` header if absent
- `req.headers["x-employee-id"]` — backfilled as a bridge for downstream code still reading the header

**Behaviors:**
- No `Authorization` header → `req.employeePerms = []`, calls `next()` (does not reject — many public/optional-auth routes rely on this).
- Kiosk scope (`decoded.scope === "kiosk"`) → restricted to paths matching `/^\/api\/attendance\/pin-/` or `/^\/api\/auth\//`. Anything else → 403 `KIOSK_RESTRICTED`.
- Token revocation: checks `revoked_tokens` table by `jti`, then `employees.tokens_revoked_before` vs `decoded.iat`. Missing table/column errors are swallowed (pre-migration tolerance).
- Permission lookup (`role_id`/`role_permissions`) uses the **tenant-scoped** DB (`tenantDbManager.getDb(decoded.tid)` in MT) — retries once after a 100ms delay on transient failure. Both attempts failing → 503 `PERM_LOAD_FAILED` (deliberately not silent-empty-perms, which used to masquerade as a misleading 403 for Admins).
- Impersonation appends `" (impersonated by Super-Admin)"` to `req.employee.name`.
- JWT errors: `TokenExpiredError` → 401 `TOKEN_EXPIRED`; `JsonWebTokenError`/`NotBeforeError` → 401 `INVALID_TOKEN`; anything else unexpected → 401 `AUTH_FAILED` (logged, not silently passed through).

### `resolveTenant(req, res, next)`
No-op in single-tenant mode. In MT mode:
- Resolves tenant ID from `req.tenantId` (set by `loadTenantAndPerms`), OR from `?tenant=<slug>` query param **only if** the path matches `PUBLIC_TENANT_PARAM_PATHS` (auth, kiosk pin-checkin, feature-flags, setup, health, `company-profile/currency`). This allowlist exists specifically to prevent any unauthenticated route lacking its own `requirePerm` guard from attaching a tenant DB scope via `?tenant=foo`.
- No tenant resolved on an `/api/*` path not in the allowlist → 401 `AUTH_REQUIRED` (clean failure instead of the proxy throwing "no tenant DB in async context" downstream).
- Calls `tenantDbManager.getDb(tenantId)`, then runs `asyncStore.run({ db: tenantDb }, () => next())` — this wires the AsyncLocalStorage context so the `deps.db` proxy (`tenant-db-proxy-pg.js`) routes queries to the correct schema for the rest of the request.
- Sets `req.tenantSlug` and `req.tenantDir` (local path used by `tenant-multer.js`).
- Error codes: `TENANT_NOT_FOUND` (403), `TENANT_SUSPENDED` (403, message contains "is suspended"), `TENANT_DELETED` (403, message contains "is deleted"), otherwise 500.

### `loadCompanyProfile(req, res, next)`
- Reads `company_profile WHERE id = 1` from the tenant-scoped DB (via `_getCompanyDb(req)`, which picks `dbProxy` in MT or `db` in ST).
- Cache: 5-minute TTL per tenant key (`req.tenantId` or `"_default"`). Cold start (`entry` absent) sets a `_placeholder` entry synchronously and **awaits** the first DB load — this avoids a race where the post-signup-wizard auto-login hits a stale placeholder and gets bounced with `SETUP_REQUIRED`. Warm entries refresh fire-and-forget (stale-while-revalidate).
- Sets `req.company` = full `company_profile` row (timezone, currency, FBR config, `setup_complete`, etc.).
- If `setup_complete` is falsy (and not a placeholder) and path isn't `/api/setup*` or `/api/health*` (and tenant is resolved in MT) → 503 `SETUP_REQUIRED`.
- `invalidateCompanyProfileCache(tenantIdOrSlug)` — call after setup-complete or profile edits to force a fresh read on the next request. Pass nothing/`null` to clear the whole cache.

### `resolveContext(req, res, next)`
- Reads `x-company-id`, `x-outlet-id`, `x-scope-mode` headers → `req.context = { companyId, outletId, scopeMode }` (all `null` if absent — this **overwrites** any `req.context` set earlier by `loadTenantAndPerms`, except it re-derives `outletId` from the header which was itself backfilled from the JWT `oid` claim, so the effective value survives).
- Checks `context_header_enforced` feature flag with its own tiny cache (`CONTEXT_FLAG_CACHE_MS` = 30s, separate from the feature-flags module's own cache).
- When enforced and path is under `/api/`: exempt paths (`CONTEXT_EXEMPT_PATHS` — auth, context, feature-flags, attendance pin-, roles/:id/permissions, outlets) skip the check. Non-exempt requests with no `x-employee-id` header pass through silently (`next()` — relies on later auth middleware to reject). Non-admin employees (no `all_access`) without `x-outlet-id` → 428 `CONTEXT_REQUIRED`.

**`req.*` set by the full chain:** `req.tenantId`, `req.tenantSlug`, `req.tenantDir`, `req.employee`, `req.employeePerms`, `req.tokenScope`, `req.isImpersonating`, `req.impersonatedBy`, `req.company`, `req.context`

**Env vars:** `JWT_SECRET`, `MULTI_TENANT`

**Mount order:** `loadTenantAndPerms` → `resolveTenant` → (tenant `/uploads` static) → `loadCompanyProfile` → `resolveContext`. All tenant-scoped routes mount after this chain completes.

---

## permissions.js

**Exports:** `requirePerm`, `requireAnyPerm`, `requireContextOutlet`, `DEFAULT_ROLE_PERMISSIONS`, `ensureDefaultRolePermissions`, `PERMISSION_RULES`

### `requirePerm(permission)`
Returns middleware. Checks `req.employeePerms` (array). `"all_access"` bypasses everything. Returns 403 `{ error: "Forbidden: insufficient permissions" }` on failure.

### `requireAnyPerm(permissions[])`
Same shape but accepts an array — passes if employee has `all_access` OR any one of the listed permissions.

### `requireContextOutlet(req, res, next)`
If `req.context?.outletId` is set and `req.query.outlet_id` is absent, backfills `req.query.outlet_id` from context. Always calls `next()` — never blocks.

### `DEFAULT_ROLE_PERMISSIONS`
- `Administrator`: `["all_access"]`
- `Manager`: `manage_inventory`, `manage_orders`, `view_reports`, `manage_employees`, `pos_discount`, `void_sales`, `pos_park`, `pos_void`, `manage_restaurant`, `manage_kds`, `manage_bookings`, `manage_projects`, `manage_contracts`, `manage_tickets`, `manage_rentals`, `manage_rooms`, `manage_treatment_plans`, `manage_tips`, `override_void_comp`, `manage_gift_cards`, `override_price`, `override_credit_limit`, `manage_field_sales`
- `Cashier`: `["view_reports", "pos_discount", "pos_park"]`
- `"Field Rep"`: `["manage_field_sales"]` — minimal role for wholesale mobile order-booker/DSR app; only sees own route/check-ins/visit history (enforced in route handlers, not here)

### `ensureDefaultRolePermissions(db)`
Async. Looks up `roles` table, and for each role name in `DEFAULT_ROLE_PERMISSIONS` inserts each permission via `INSERT ... ON CONFLICT DO NOTHING`. Idempotent — safe to call repeatedly (e.g. during tenant provisioning or role backfills). Swallows/logs errors rather than throwing.

### `PERMISSION_RULES`
Declarative array of `{ methods: [...], path: /regex/, anyPerms: [...] }` covering route-level guards for reports, attendance, categories/brands/products/attribute-sets/barcode templates/expenses, outlets, receipt templates, suppliers/supplier-returns/supplier-invoices, returns, approvals, PO/transfer submit+approve, parked sales, restaurant, KDS, bookings/appointments, projects, contracts, service tickets, rentals, rooms, treatment plans (+ clinical sub-resources), tips. Consumed by tests and/or route registration as a reference table — **not** auto-applied; individual routes still call `requirePerm`/`requireAnyPerm` directly.

**`req.*` read:** `req.employeePerms`, `req.context`

---

## feature-flags.js

**Exports:** `init(deps)`, `DEFAULT_FEATURE_FLAGS`, `getFeatureFlagsMap`, `getModesMap`, `invalidateFeatureFlagCache`, `invalidateModeCache`, `requireFeature`, `requireMode`, `createNotification`, `notifyLowStockForSale`

**Requires `init(deps)`** at boot with `{ db, IS_MULTI_TENANT, tenantDbManager, dbProxy }`. `init()` also picks `_notifDb = IS_MULTI_TENANT ? dbProxy : db` for the notification helpers below.

### `requireFeature(flagKey)`
Returns async middleware. Fetches the flag map for `req.tenantId`, returns 403 `{ error: "Feature disabled: <key>", flag: "<key>" }` if off (intentionally 403 not 503 — "feature off" is a permission-style refusal, not a service outage, so it won't trip alerting on routine POS capability probes). Returns 500 on unexpected DB error.

### `requireMode(modeName)`
Returns async middleware. Fetches the mode map (`tenant_modes` table) for `req.tenantId`. If the map is **empty** (table not yet migrated, or tenant has no mode rows), falls through — treats feature flags as the sole gate (back-compat). Otherwise 403 `{ error: "Mode not enabled: <name>", mode: "<name>" }` if the named mode is off/missing. Table-missing errors also fall through via `next()`.

### `getFeatureFlagsMap(tenantId)`
Async. Merges `DEFAULT_FEATURE_FLAGS` with rows from the `feature_flags` table (DB row `enabled` overrides default). 60s in-memory cache keyed by `tenantId` (or `"_default"`). Falls back to `DEFAULT_FEATURE_FLAGS` if the table doesn't exist yet. In MT mode, queries the tenant-scoped DB via `tenantDbManager.getDb()`; falls back to `db` if that lookup fails.

### `getModesMap(tenantId)`
Async. Queries `tenant_modes` table, 60s cache. Returns `{}` if `init()` was never called (e.g. some test harnesses) or the table doesn't exist.

### `invalidateFeatureFlagCache(tenantId)` / `invalidateModeCache(tenantId)`
Bust the respective cache for one tenant, or the whole cache if `tenantId` is falsy. Call after admin flag/mode mutations.

### `createNotification(type, title, message, link)`
Fire-and-forget `INSERT INTO notifications`. Errors silently swallowed.

### `notifyLowStockForSale(cartItems, outletId)`
Dedupes product IDs from cart items, queries `outlet_stock` joined to `products` for quantity ≤ 10, calls `createNotification("low_stock", ...)` per row. Fire-and-forget; no-ops if `outletId` or product list is empty.

**`req.*` read:** `req.tenantId`

**Env vars:** none directly — `IS_MULTI_TENANT` is injected via `init(deps)`, not read from `process.env` in this file.

**Gotchas:**
- `fbr_integration` is **not** in `DEFAULT_FEATURE_FLAGS` — DB-seeded by migration v9. A brand-new tenant DB row overrides the (absent) default.
- Most `DEFAULT_FEATURE_FLAGS` entries are mode-gated (restaurant, appointments, rentals, rooms, treatment plans, wholesale, etc.) and default `false` — they're flipped on by the setup wizard or a migration backfill for the matching preset, never globally.
- `ai_insights` is a soft DB check inside `routes/insights-ai.js`, not enforced via `requireFeature()` here.
- Shopify routes gate on an active-connection check, not a feature flag.

---

## plan-limits.js

**Exports:** `requirePlanLimit`, `requireActiveSubscription`, `PLAN_DEFAULTS`

### `requirePlanLimit(resource)`
`resource` must be `"employees"`, `"outlets"`, or `"products"` — throws synchronously (at middleware-construction time, not request time) for anything else.

Returns async middleware:
- No-op when `MULTI_TENANT !== "1"`.
- No-op if `req.tenantId` is absent (lets downstream auth handle the rejection).
- Reads `max_<resource>` from `public.tenants` via `master-db-pg.js`. `null`/`<= 0` = unlimited → passes through.
- Counts current rows via the tenant-scoped DB (`tenant-db-manager-pg.js:getDb`) — soft-deleted rows (`deleted_at IS NULL`) excluded for employees/products; outlets has no soft-delete column.
- At/over limit → 403 `{ error, code: "PLAN_LIMIT_REACHED", limit, current }`.
- Any lookup failure → best-effort `next()` (never blocks a request on infra failure).

### `requireActiveSubscription(req, res, next)`
Synchronous function body, async check via `.then()`/`.catch()` (not `await` — the outer function returns before the DB round-trip resolves; Express still handles the eventual response correctly, but you cannot wrap a call site in try/catch expecting a thrown error).
- No-op for: `GET`/`OPTIONS`/`HEAD`, `MULTI_TENANT !== "1"`, and paths under `/api/auth/`, `/api/billing/`, `/api/support/`, `/api/setup/`, `/api/health`, `/api/receipts/` (these must always work regardless of subscription state).
- No-op if `req.tenantId` is absent.
- Free-plan tenants (`plan === "free"`) are **never** blocked, regardless of `payment_status` drift.
- `payment_status === "expired"` → 403 `{ error, code: "SUBSCRIPTION_EXPIRED", billing_url: "/billing" }`.
- Lookup failure → best-effort `next()`.

### `PLAN_DEFAULTS`
```js
{
  free: { max_outlets: 1, max_employees: 3, max_products: 100 },
  pro:  { max_outlets: 1, max_employees: 0, max_products: 0 },
}
```
`0` = unlimited. Applied at tenant provisioning / plan change — not read live by the middleware itself (which reads the tenant row's own columns).

**`req.*` read:** `req.tenantId`, `req.method`, `req.path`

**Env vars:** `MULTI_TENANT`

---

## rate-limit.js

All limiters are `express-rate-limit` instances; all use the shared `limitExceededHandler` → 429 with `Retry-After` header (seconds) and body `{ error: "Too many requests", retry_after_seconds }`.

**Exports:** `globalLimiter`, `authLimiter`, `webhookLimiter`, `reviewLimiter`, `publicBookingLimiter`, `publicRestaurantLimiter`, `customerPortalAuthLimiter`, `customerPortalOtpLimiter`, `customerPortalDataLimiter`, `manufacturerPortalAuthLimiter`, `manufacturerPortalDataLimiter`, `pinValidateLimiter`

| Limiter | Window | Max | Key | Test skip |
|---|---|---|---|---|
| `globalLimiter` | `RATE_LIMIT_WINDOW_MS` (default 60s) | `RATE_LIMIT_GLOBAL_MAX` (default 600) | `{tenantSlugOrSt}:{ip}` | n/a — uses `skip` for POS burst paths instead |
| `authLimiter` | 15 min | `RATE_LIMIT_AUTH_MAX` (default 20) | `{store_code or tenant slug}:{ip}` (ST: `req.ip` only) | yes |
| `webhookLimiter` | 60s | `RATE_LIMIT_WEBHOOK_MAX` (default 120) | ip (default keyGenerator) | no |
| `reviewLimiter` | 15 min | 5 | `review:{tenant}:{ip}` | yes |
| `publicBookingLimiter` | 15 min | 10 | `pubbook:{tenant}:{ip}` | yes |
| `publicRestaurantLimiter` | 60s | 60 | `pubrest:{tenant}:{ip}` | yes |
| `customerPortalAuthLimiter` | 15 min | 10 | `portal-auth:{slug}:{ip}` | yes |
| `customerPortalOtpLimiter` | 15 min | 5 | `portal-otp:{email}:{ip}` | yes |
| `customerPortalDataLimiter` | 60s | 120 | `portal-data:{customerId}` else `portal-data:{slug}:{ip}` | yes |
| `manufacturerPortalAuthLimiter` | 15 min | 5 | `mfg-portal-auth:{slug}:{ip}` | yes |
| `manufacturerPortalDataLimiter` | 60s | 60 | `mfg-portal-data:{manufacturerId}` else `mfg-portal-data:{slug}:{ip}` | yes |
| `pinValidateLimiter` | 15 min | 20 | `pin-validate:{tenant}:{ip}` | yes |

**`globalLimiter` skips** (`isPosBurstPath`): `/api/sales`, `/api/products/search`, `/api/products/scan/`, `/api/orders` — these are POS hot paths that would otherwise blow through the global cap under normal cashier usage.

**Env vars:** `MULTI_TENANT`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_WEBHOOK_MAX`, `NODE_ENV` (test-mode skip)

**Gotcha:** Portal limiters (customer + manufacturer) and the review/booking/restaurant limiters all key on `?tenant=` query param or `x-tenant-slug` header rather than `req.tenantSlug`, because they sit on routes mounted **before** `loadTenantAndPerms`/`resolveTenant` run.

---

## validate.js

**Exports:** `{ validate }`

### `validate(schema)`
Factory. Returns Express middleware: `schema.parse(req.body || {})`.
- On success, **replaces** `req.body` with the parsed (coerced/stripped) result — downstream handlers must not assume the original raw body shape.
- On `ZodError` → 400 `{ error: "<first issue message>", details: [{ field, message }] }`. `field` is the dot-joined path (e.g. `"items.0.price"`). Handles both `err.issues` (newer Zod) and `err.errors` (older) via `??` fallback.
- Non-Zod errors forwarded to `next(err)`.

Schemas live in `backend/schemas/` — no inline Zod schemas in route files.

---

## upload-validation.js

**Exports:** `imageFileFilter`, `rasterImageFileFilter`, `clinicalDocFileFilter`, `safeExtension`, `detectImageType`, `verifyImageMagicBytes`, `ALLOWED_IMAGE_MIMES`, `ALLOWED_IMAGE_EXTS`, `ALLOWED_RASTER_IMAGE_MIMES`, `ALLOWED_RASTER_IMAGE_EXTS`, `ALLOWED_CLINICAL_DOC_MIMES`, `ALLOWED_CLINICAL_DOC_EXTS`

Built on a shared factory `makeImageFileFilter(allowedMimes, allowedExts)` that checks both `file.mimetype` and `path.extname(file.originalname)` against allowlists.

### `imageFileFilter`
Full image allowlist including SVG: JPEG, PNG, GIF, WebP, SVG, BMP, TIFF. Use only for uploads that get rasterized (e.g. `sharp`) before being served back — product images.

### `rasterImageFileFilter`
Same set minus SVG. **Use for anything stored as-is and served from a same-origin URL** — SVG can carry `<script>`/`onload` payloads that execute when fetched as a top-level document with the API's auth cookies attached (see P31: support-upload XSS → session takeover via `/api/auth/refresh`). Support ticket screenshots use this filter.

### `clinicalDocFileFilter`
Raster images + `application/pdf` + `text/plain`, no SVG. For treatment-plan clinical document uploads (lab reports, referrals, imaging) — needs to accept non-image formats but still exclude anything that could execute same-origin.

### `detectImageType(buffer)`
Magic-byte sniffer — JPEG, PNG, GIF, WebP, BMP, TIFF (both endiannesses), PDF. Returns `null` if unrecognized. No SVG/text detection (no magic bytes).

### `verifyImageMagicBytes(buffer, claimedMime)`
Returns `true`/`false` by comparing `detectImageType(buffer)` to `claimedMime`. `text/plain` always passes (no magic bytes to check — relies on the fileFilter allowlist + extension). Use this **after** multer accepts a file to catch a faked `Content-Type` (P32 — e.g. an `.exe` renamed to `.jpg` with a spoofed `image/jpeg` header).

### `safeExtension(originalname, mimetype)`
Returns the original extension if it's in `ALLOWED_IMAGE_EXTS`, else derives one from the MIME type, else defaults to `.png`.

**No env vars.**

---

## customer-auth.js

Customer portal JWT auth (M8) — entirely separate secret/scope from employee auth. Mounted **before** the employee tenant middleware chain, so `req.employee`/`req.company` are never set on portal requests; tenant DB routing goes through `resolvePublicTenantDb()` (`services/public-tenant-context`) instead of `resolveTenant`.

**Exports:** `loadCustomerAuth(deps)`, `signCustomerTokens(customer, tenant)`, `verifyCustomerToken(token)`, `hashRefreshToken(token)`, `getSecret()`

### `loadCustomerAuth(deps)`
Factory — returns async `customerAuth(req, res, next)`.
- Reads `Authorization: Bearer <token>` → 401 `"Missing bearer token"` if absent/malformed.
- Verifies with `getSecret()` → 401 `"Invalid or expired token"` on failure.
- Rejects if `payload.scope !== "customer"` (blocks staff/manufacturer tokens) or `payload.type === "refresh"` (refresh tokens can't be used as access tokens).
- Calls `resolvePublicTenantDb(req, deps)` — reads tenant from `?tenant=` / `x-tenant-slug`. Cross-checks `payload.tid` against the resolved tenant ID (blocks replay against a different tenant).
- Looks up `customers.portal_tokens_revoked_before` — rejects with 401 `"Session revoked"` if the token's `iat` predates the cursor (set on password reset / logout-all). Also 401s if the customer row is missing or soft-deleted.

**Sets on `req`:** `req.customerId`, `req.tenantId`, `req.tenant` (`{ id, slug }`), `req.db` (tenant-scoped, from the resolver — **not** the standard `deps.db` ALS proxy).

### `signCustomerTokens(customer, tenant)`
Returns `{ accessToken, refreshToken, refreshHash, refreshExpiresAt }`. Both tokens carry `{ cid, tid, tslug, scope: "customer", jti }` (refresh also has `type: "refresh"`). `refreshHash` (SHA-256 of raw token) is what gets persisted — never store the raw refresh token.

### `getSecret()` / `verifyCustomerToken(token)` / `hashRefreshToken(token)`
`getSecret()` returns `CUSTOMER_PORTAL_JWT_SECRET`, falling back to `JWT_SECRET` (one-time console warning), falling back to `"dev-insecure-secret"`.

**Env vars:** `CUSTOMER_PORTAL_JWT_SECRET`, `JWT_SECRET`, `CUSTOMER_PORTAL_ACCESS_TTL` (default `"30m"`), `CUSTOMER_PORTAL_REFRESH_TTL` (default `"30d"`)

---

## manufacturer-auth.js

Manufacturer partner portal JWT auth (Tier 1.4) — same shape as `customer-auth.js`, separate secret/scope, separate table. Mounted before the employee tenant middleware chain; uses `resolvePublicTenantDb()` too.

**Exports:** `loadManufacturerAuth(deps)`, `signManufacturerTokens(partner, tenant)`, `verifyManufacturerToken(token)`, `hashRefreshToken(token)`, `getSecret()`

### `loadManufacturerAuth(deps)`
Factory — returns async `manufacturerAuth(req, res, next)`. Mirrors `loadCustomerAuth` structure:
- Bearer token required; scope must be `"manufacturer"`; refresh tokens rejected as access tokens.
- `resolvePublicTenantDb()` + cross-tenant `tid` check, same as customer portal.
- Looks up `manufacturer_partners` by `payload.mid` — additionally checks `status`: `"suspended"` → 403 `"Partner access suspended"`; anything other than `"active"` → 401 `"Partner not active"`; missing row → 401 `"Manufacturer partner not found"`.
- Honors `portal_tokens_revoked_before` cursor the same way as the customer portal.

**Sets on `req`:** `req.manufacturerId`, `req.tenantId`, `req.tenant`, `req.db`.

### `signManufacturerTokens(partner, tenant)`
Same structure as `signCustomerTokens` but payload key is `mid` (not `cid`) and `scope: "manufacturer"`.

**Env vars:** `MANUFACTURER_PORTAL_JWT_SECRET` (falls back to `JWT_SECRET`), `MANUFACTURER_PORTAL_ACCESS_TTL` (default `"15m"` — intentionally shorter than the customer portal's 30m; manufacturer reports expose aggregate revenue/scheme data, considered more sensitive), `MANUFACTURER_PORTAL_REFRESH_TTL` (default `"30d"`)

**Gotcha:** `customer-auth.js` and `manufacturer-auth.js` are near-identical in structure (both delegate to `resolvePublicTenantDb`, both use the cid/mid + tid + tslug + scope + jti token shape, both support a per-principal revocation cursor). If you change one, check whether the same fix applies to the other — they've drifted apart in TTL and status-check details but share the same auth bypass surface (e.g. the P8/security-audit `?tenant=` lockdown pattern applies to both).

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
