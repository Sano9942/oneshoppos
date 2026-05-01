# Middleware — Claude Guide

Only `tenant-auth.js` and `feature-flags.js` expose `init(deps)` — all other middleware files export plain functions. Middleware chain order is in `backend/CLAUDE.md`.

---

## request-id.js

**Exports:** default function `requestId`, named `requestId.enrichReqLog`

**What it does:**
- Wraps `pino-http`. Generates a UUID per request or honours the incoming `X-Request-Id` header.
- Sets `X-Request-Id` response header.
- Attaches `req.log` (Pino child logger) and `req.id`.
- Attaches `req._startTime = Date.now()`.
- Log level: `error` for 5xx or thrown error, `warn` for 4xx or duration >2000ms, `info` otherwise.
- Serializers are minimal — no full request/response bodies.

**`enrichReqLog(req, res, next)`:**
- Wire AFTER `loadTenantAndPerms`. Re-binds `req.log` as a child with `{ tenantSlug, employeeId }` once those are available.
- Safe to call even if `req.log` is absent — no-ops in that case.

**`req.*` set:** `req.log`, `req.id`, `req._startTime`

**Env vars:** none (reads `pino-http` defaults from logger instance)

---

## tenant-auth.js

**Exports:** `init(deps)`, `loadEmployeePerms`, `loadTenantAndPerms`, `resolveTenant`, `loadCompanyProfile`, `resolveContext`, `invalidateCompanyProfileCache`

**Requires `init(deps)`** at boot with `{ db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore }`.

### `loadEmployeePerms(req, res, next)`
Header-based only (no JWT). Reads `x-employee-id` header. Validates range (1–999999). Queries `employees` + `role_permissions` directly. Sets `req.employeePerms = []` on missing employee or any error. Does NOT set `req.employee` or `req.tenantId`.

### `loadTenantAndPerms(req, res, next)`
Primary JWT auth middleware. Reads `Authorization: Bearer <token>`.

**Sets on `req`:**
- `req.tenantId` — from `decoded.tid`
- `req.employee` — `{ id, role_id, name, email }`
- `req.employeePerms` — array of permission strings
- `req.tokenScope` — `"full"` (default) or `"kiosk"`
- `req.isImpersonating` — boolean
- `req.impersonatedBy` — real identity object (only when impersonating)
- `req.context.outletId` — from `decoded.oid` JWT claim (if present)
- `req.headers["x-employee-id"]` — backfilled as bridge for downstream code

**Behaviors:**
- No `Authorization` header → sets `req.employeePerms = []`, calls `next()` (does not reject).
- Kiosk scope (`decoded.scope === "kiosk"`) → restricts to paths matching `^\/api\/attendance\/pin-` or `^\/api\/auth\/`. Other paths get 403 `KIOSK_RESTRICTED`.
- Token revocation: checks `revoked_tokens` table by `jti`, then `employees.tokens_revoked_before` vs `decoded.iat`. DB errors on these checks are swallowed (graceful degradation — table may not exist yet).
- Permission load retries once after 100ms delay on transient DB failure. Both attempts failing returns 503 `PERM_LOAD_FAILED` instead of silent empty-perms (which would surface as misleading 403).
- Impersonation: appends `" (impersonated by Super-Admin)"` to `req.employee.name`.
- JWT errors: `TokenExpiredError` → 401 `TOKEN_EXPIRED`; `JsonWebTokenError` → 401 `INVALID_TOKEN`; unexpected errors → 401 `AUTH_FAILED`.

### `resolveTenant(req, res, next)`
No-op in single-tenant mode. In MT mode:
- Resolves tenant from `req.tenantId` (set by `loadTenantAndPerms`) or `?tenant=slug` query param.
- Calls `tenantDbManager.getDb(tenantId)` which sets `search_path` for the tenant schema.
- Runs `asyncStore.run({ db: tenantDb }, () => next())` — this is what wires up the AsyncLocalStorage context so `deps.db` proxy routes queries to the correct schema.
- Sets `req.tenantSlug` and `req.tenantDir` (local filesystem path, used by `tenant-multer.js`).
- Error codes: `TENANT_NOT_FOUND` (403), `TENANT_SUSPENDED` (403), `TENANT_DELETED` (403).
- No tenant resolved → calls `next()` without error.

### `loadCompanyProfile(req, res, next)`
- Reads `company_profile WHERE id = 1` from the tenant-scoped DB.
- Cache: 5-minute TTL per tenant (`_default` key in ST mode). Cold start awaits the first load. Subsequent refreshes are fire-and-forget (stale-while-revalidate).
- Sets `req.company` — full `company_profile` row (includes `timezone`, `currency_symbol`, `setup_complete`, FBR config, etc.).
- If `setup_complete` is falsy AND the path is not `/api/setup*` or `/api/health*` → returns 503 `SETUP_REQUIRED`.
- In single-tenant mode, `_warmCaches()` (called from `init`) pre-populates the cache at boot and generates a `setup_token` if setup is incomplete (logged to console).
- Call `invalidateCompanyProfileCache(tenantIdOrSlug)` to bust the cache immediately (used by setup-complete endpoint).

### `resolveContext(req, res, next)`
- Reads `x-company-id`, `x-outlet-id`, `x-scope-mode` headers.
- Sets `req.context = { companyId, outletId, scopeMode }` (null if headers absent).
- Checks `context_header_enforced` feature flag (30s async cache). When enforced and `x-outlet-id` is absent, non-admin employees get 428 `CONTEXT_REQUIRED`.
- Exempt paths from context enforcement: `/api/auth/`, `/api/context/`, `/api/feature-flags`, `/api/attendance/pin-`, `/api/roles/:id/permissions`, `/api/outlets`.

**`req.*` set by the chain:** `req.tenantId`, `req.tenantSlug`, `req.tenantDir`, `req.employee`, `req.employeePerms`, `req.tokenScope`, `req.isImpersonating`, `req.impersonatedBy`, `req.company`, `req.context`

**Env vars:** `JWT_SECRET`, `MULTI_TENANT`

---

## permissions.js

**Exports:** `requirePerm`, `requireAnyPerm`, `requireContextOutlet`, `DEFAULT_ROLE_PERMISSIONS`, `ensureDefaultRolePermissions`, `PERMISSION_RULES`

### `requirePerm(permission)`
Returns middleware. Checks `req.employeePerms`. `"all_access"` bypasses all permission checks. Returns 403 `{ error: "Forbidden: insufficient permissions" }` on failure.

### `requireAnyPerm(permissions[])`
Same as `requirePerm` but accepts an array — passes if employee has `all_access` OR any one of the listed permissions.

### `requireContextOutlet(req, res, next)`
If `req.context.outletId` is set and `req.query.outlet_id` is absent, backfills `req.query.outlet_id` from context. Always calls `next()`.

### `DEFAULT_ROLE_PERMISSIONS`
Canonical permission sets:
- `Administrator`: `["all_access"]`
- `Manager`: 21 permissions — `manage_inventory`, `manage_orders`, `view_reports`, `manage_employees`, `pos_discount`, `void_sales`, `pos_park`, `pos_void`, `manage_restaurant`, `manage_kds`, `manage_bookings`, `manage_projects`, `manage_contracts`, `manage_tickets`, `manage_rentals`, `manage_rooms`, `manage_treatment_plans`, `manage_tips`, `override_void_comp`, `manage_gift_cards`, `override_price`
- `Cashier`: `["view_reports", "pos_discount", "pos_park"]`

### `ensureDefaultRolePermissions(db)`
Async. Idempotently inserts default permissions for each role using `ON CONFLICT DO NOTHING`. Call from boot/provisioning code.

### `PERMISSION_RULES`
Declarative array of `{ methods[], path (regex), anyPerms[] }` for route-level guards. Covers: reports, attendance, categories, brands, products, attribute-sets, barcode templates, expenses, outlets, receipt templates, suppliers, returns, approvals, POs, transfers, parked sales, restaurant, KDS, bookings, appointments, projects, contracts, service tickets, rentals, rooms, treatment plans, tips.

**`req.*` read:** `req.employeePerms`, `req.context`

---

## feature-flags.js

**Exports:** `init`, `DEFAULT_FEATURE_FLAGS`, `getFeatureFlagsMap`, `getModesMap`, `invalidateFeatureFlagCache`, `invalidateModeCache`, `requireFeature`, `requireMode`, `createNotification`, `notifyLowStockForSale`

**Requires `init(deps)`** at boot with `{ db, IS_MULTI_TENANT, tenantDbManager, dbProxy }`.

### `requireFeature(flagKey)`
Returns async middleware. Fetches flag map, returns 403 `{ error: "Feature disabled: <key>", flag: "<key>" }` if the flag is off. Returns 500 on DB error.

### `requireMode(modeName)`
Returns async middleware. Fetches mode map from `tenant_modes` table. Returns 403 `{ error: "Mode not enabled: <name>", mode: "<name>" }` if off. If the modes map is empty (pre-migration), falls through — modes table may not exist yet.

### `getFeatureFlagsMap(tenantId)`
Async. Merges `DEFAULT_FEATURE_FLAGS` with DB rows from `feature_flags` table. Cache: 60s per tenant. If `feature_flags` table does not exist, returns `DEFAULT_FEATURE_FLAGS` (graceful degradation). MT mode queries the tenant-scoped DB.

### `getModesMap(tenantId)`
Async. Queries `tenant_modes` table. Cache: 60s per tenant. Returns `{}` if table missing.

### `invalidateFeatureFlagCache(tenantId)`
Busts the flag cache for a specific tenant (or all tenants if `tenantId` is falsy). Call after admin flag updates.

### `invalidateModeCache(tenantId)`
Same pattern as `invalidateFeatureFlagCache` but for the mode cache.

### `createNotification(type, title, message, link)`
Fire-and-forget INSERT into `notifications` table. Uses `_notifDb` (dbProxy in MT, direct db in ST). Errors are silently swallowed.

### `notifyLowStockForSale(cartItems, outletId)`
Queries `outlet_stock` for products in the cart where quantity ≤ 10. Calls `createNotification("low_stock", ...)` for each. Fire-and-forget.

**`req.*` read:** `req.tenantId`

**Env vars:** `MULTI_TENANT` (via `IS_MULTI_TENANT` injected at init)

**Gotchas:**
- `fbr_integration` is NOT in `DEFAULT_FEATURE_FLAGS` — it is DB-seeded by migration v9.
- `ai_insights` is a soft DB check in `routes/insights-ai.js`, not enforced via `requireFeature()`.
- Shopify routes are not flag-gated; they check for an active Shopify connection instead.

---

## plan-limits.js

**Exports:** `requirePlanLimit`, `requireActiveSubscription`, `PLAN_DEFAULTS`

### `requirePlanLimit(resource)`
`resource` must be `"employees"`, `"outlets"`, or `"products"`. Throws synchronously if unknown resource passed.

Returns async middleware:
- No-op in single-tenant mode (`MULTI_TENANT !== "1"`).
- Reads `max_<resource>` from `public.tenants` via `masterDb`.
- `0` or `null` = unlimited — passes through.
- Counts current rows from tenant DB (soft-deleted rows excluded for employees/products).
- Returns 403 `{ error, code: "PLAN_LIMIT_REACHED", limit, current }` when at or over limit.
- DB lookup failure → best-effort, calls `next()` rather than blocking.

### `requireActiveSubscription(req, res, next)`
Synchronous entry, async check (uses `.then()` not `await`):
- No-op for: GET/OPTIONS/HEAD, non-MT mode, paths starting with `/api/auth/`, `/api/billing/`, `/api/support/`, `/api/setup/`, `/api/health`, `/api/receipts/`.
- Free plan tenants are never blocked (`plan === "free"` bypasses the check).
- `payment_status === "expired"` → 403 `{ error, code: "SUBSCRIPTION_EXPIRED", billing_url: "/billing" }`.
- DB failure → best-effort, calls `next()`.

**Gotcha:** `requireActiveSubscription` uses `.then()` on the DB promise rather than `await`. The function returns synchronously (before the DB query resolves). This is intentional — Express handles the async response — but means the outer function is not `async` and cannot be caught with `try/catch` at the call site.

### `PLAN_DEFAULTS`
```js
{
  free: { max_outlets: 1, max_employees: 3, max_products: 100 },
  pro:  { max_outlets: 1, max_employees: 0, max_products: 0 },
}
```
`0` = unlimited.

**`req.*` read:** `req.tenantId`, `req.method`, `req.path`

**Env vars:** `MULTI_TENANT`

---

## rate-limit.js

**Exports:** `globalLimiter`, `authLimiter`, `webhookLimiter`, `reviewLimiter`, `publicBookingLimiter`, `customerPortalAuthLimiter`, `customerPortalOtpLimiter`, `customerPortalDataLimiter`

All limiters return 429 with `Retry-After` header (seconds to reset) and body `{ error: "Too many requests", retry_after_seconds: N }`.

| Limiter | Window | Max | Key | Skip |
|---|---|---|---|---|
| `globalLimiter` | `RATE_LIMIT_WINDOW_MS` (default 60s) | `RATE_LIMIT_GLOBAL_MAX` (default 600) | `{tenantSlug}:{ip}` | POS burst paths (see below), ST uses `"st"` as tenant key |
| `authLimiter` | 15 min | `RATE_LIMIT_AUTH_MAX` (default 20) | `{store_code or tenant slug}:{ip}` | `NODE_ENV === "test"` |
| `webhookLimiter` | 60s | `RATE_LIMIT_WEBHOOK_MAX` (default 120) | ip | never |
| `reviewLimiter` | 15 min | 5 | `review:{tenant}:{ip}` | `NODE_ENV === "test"` |
| `publicBookingLimiter` | 15 min | 10 | `pubbook:{tenant}:{ip}` | `NODE_ENV === "test"` |
| `customerPortalAuthLimiter` | 15 min | 10 | `portal-auth:{slug}:{ip}` | `NODE_ENV === "test"` |
| `customerPortalOtpLimiter` | 15 min | 5 | `portal-otp:{email}:{ip}` | `NODE_ENV === "test"` |
| `customerPortalDataLimiter` | 60s | 120 | `portal-data:{customerId}` or `portal-data:{slug}:{ip}` | `NODE_ENV === "test"` |

**POS burst paths skipped by `globalLimiter`:** `/api/sales`, `/api/products/search`, `/api/products/scan/`, `/api/orders`

**Env vars:** `MULTI_TENANT`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_WEBHOOK_MAX`, `NODE_ENV`

**Gotcha:** Portal limiters key on `?tenant=` query param or `x-tenant-slug` header because they mount before `loadTenantAndPerms` — `req.tenantSlug` is not set at that point.

---

## customer-auth.js

**Exports:** `loadCustomerAuth(deps)`, `signCustomerTokens(customer, tenant)`, `verifyCustomerToken(token)`, `hashRefreshToken(token)`, `getSecret()`

Provides customer portal JWT auth (separate from employee auth). Mounted before the employee tenant middleware chain.

### `loadCustomerAuth(deps)`
Factory — returns async `customerAuth(req, res, next)` middleware.

**Reads:** `Authorization: Bearer <token>` header.

**Validates:**
- Token scope must be `"customer"` — rejects staff tokens (which carry `scope: "full"` or `"kiosk"`).
- Refresh tokens (`type === "refresh"`) cannot be used as access tokens.
- Cross-tenant replay: `payload.tid` must match the resolved tenant's `id`.
- Per-customer revocation: checks `customers.portal_tokens_revoked_before` column vs token `iat`. Tokens issued before the cursor are rejected with 401 `"Session revoked"`.

**Sets on `req`:**
- `req.customerId` — customer ID from token payload (`payload.cid`)
- `req.tenantId` — resolved tenant ID
- `req.tenant` — `{ id, slug }` object
- `req.db` — tenant-scoped DB from `resolvePublicTenantDb()`

**Does NOT set:** `req.employee`, `req.employeePerms`, `req.company` — these are employee-side fields.

### `signCustomerTokens(customer, tenant)`
Returns `{ accessToken, refreshToken, refreshHash, refreshExpiresAt }`.
- Both tokens contain `{ cid, tid, tslug, scope: "customer", jti }`.
- `refreshHash` is SHA-256 of the raw refresh token — store this in DB, not the raw token.
- `refreshExpiresAt` is ISO string of the refresh token's `exp`.
- Access TTL: `CUSTOMER_PORTAL_ACCESS_TTL` (default `"30m"`).
- Refresh TTL: `CUSTOMER_PORTAL_REFRESH_TTL` (default `"30d"`).

### `getSecret()`
Returns `CUSTOMER_PORTAL_JWT_SECRET` or falls back to `JWT_SECRET` with a one-time console warning. Falls back to `"dev-insecure-secret"` if neither is set.

### `hashRefreshToken(token)`
SHA-256 hex hash of the raw refresh token string.

**Env vars:** `CUSTOMER_PORTAL_JWT_SECRET`, `JWT_SECRET`, `CUSTOMER_PORTAL_ACCESS_TTL`, `CUSTOMER_PORTAL_REFRESH_TTL`

**Gotcha:** Tenant DB routing uses `resolvePublicTenantDb()` from `services/public-tenant-context` (same pattern as storefront/public booking routes — not the standard employee `resolveTenant` middleware). The resolver reads the tenant slug from `?tenant=` query param or `x-tenant-slug` header.

---

## validate.js

**Exports:** `{ validate }`

### `validate(schema)`
Factory. Returns Express middleware that calls `schema.parse(req.body || {})`.

- Replaces `req.body` with the parsed (and potentially coerced/stripped) result on success.
- On `ZodError`: returns 400 `{ error: "<first issue message>", details: [{ field, message }] }`. `field` is the dot-joined path (e.g. `"items.0.price"`).
- Non-Zod errors are forwarded to `next(err)`.

No inline Zod schemas — schemas are imported from `backend/schemas/`.

---

## upload-validation.js

**Exports:** `imageFileFilter`, `rasterImageFileFilter`, `safeExtension`, `detectImageType`, `verifyImageMagicBytes`, `ALLOWED_IMAGE_MIMES`, `ALLOWED_IMAGE_EXTS`, `ALLOWED_RASTER_IMAGE_MIMES`, `ALLOWED_RASTER_IMAGE_EXTS`

### `imageFileFilter`
Multer `fileFilter` function. Checks both `file.mimetype` and `path.extname(file.originalname)`. Rejects if either fails the allowlist. Allows SVG.

### `rasterImageFileFilter`
Stricter variant — excludes SVG. Use on routes that store the upload as-is and serve it from the same origin (prevents SVG XSS). Product images go through `sharp` rasterization so they can use `imageFileFilter`; support ticket screenshots use `rasterImageFileFilter`.

### `detectImageType(buffer)`
Magic-byte sniffer. Returns a MIME string or `null`. Handles JPEG, PNG, GIF, WebP, BMP, TIFF. Does NOT handle SVG (text-based, no magic bytes).

### `verifyImageMagicBytes(buffer, claimedMime)`
Returns `true` if the buffer's magic bytes match `claimedMime`. Use after multer uploads to catch files with faked Content-Type (P32 — `exe` renamed to `jpg` with matching content-type header).

### `safeExtension(originalname, mimetype)`
Returns a validated extension from the filename, falling back to a MIME-derived extension if the original is absent or not in the allowlist.

**Allowed types (both filters before SVG exclusion):** JPEG, PNG, GIF, WebP, SVG, BMP, TIFF

**No env vars.**

---

## Application Order (required)

```
globalLimiter              ← first, rate-limits before requestId (applied before requestId in backend/index.js)
requestId                  ← gives req.log + req.id to everything after
authLimiter                ← on /api/auth/* routes only

[admin routes mount here — no tenant context]
[webhook routes mount here — no auth]

loadTenantAndPerms         ← sets req.employee, req.employeePerms, req.tenantId
enrichReqLog               ← re-binds req.log with tenant/employee (optional, after above)
resolveTenant              ← sets req.tenantSlug, asyncStore context, deps.db proxy
[tenant /uploads static]
loadCompanyProfile         ← sets req.company (requires resolveTenant to have run in MT)
resolveContext             ← sets req.context (reads headers, checks feature flag)

[per-route middleware]
requirePerm / requireAnyPerm
requireFeature / requireMode
validate(schema)
requirePlanLimit(resource)
requireActiveSubscription
```

**Customer portal routes** use a separate chain: `customerPortalAuthLimiter` → `loadCustomerAuth(deps)` → route handler. These mount before `loadTenantAndPerms` and never set `req.employee`.
