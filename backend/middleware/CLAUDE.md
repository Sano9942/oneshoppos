# Middleware — Claude Guide

Only `tenant-auth.js`, `feature-flags.js`, and `outlet-context.js` expose `init(deps)` — every other file exports plain functions/factories with no boot-time wiring. Full chain order (employee/tenant path) is documented in `backend/CLAUDE.md`; this file is the per-module reference.

---

## request-id.js

**Exports:** default function `requestId`, named `requestId.enrichReqLog`

- Wraps `pino-http` (backed by the shared `services/logger.js` singleton — never construct a second Pino instance).
- `genReqId` honours an incoming `X-Request-Id` header, else `crypto.randomUUID()`. Response gets `X-Request-Id` set from `req.id`.
- `customLogLevel`: `error` for 5xx/thrown err, `warn` for 4xx or duration > `SLOW_REQUEST_MS` (2000ms), else `info`.
- `customProps` already injects `tenantSlug`/`employeeId` into the log line when present on `req` at call time — this runs on every request via pino-http's internal hook, independent of the `enrichReqLog` helper below.
- Serializers are deliberately minimal (method/url/remoteAddress, statusCode only) — no bodies logged.
- Sets `req.log`, `req.id`, `req._startTime = Date.now()`.

**`enrichReqLog(req, res, next)`** — a second, separate enrichment point: wire it AFTER `loadTenantAndPerms` to *rebind* `req.log` as a child logger carrying `{ tenantSlug, employeeId }`, for any log lines emitted by handlers using `req.log` directly (not just pino-http's own request-complete line, which `customProps` already covers). No-op if `req.log` is absent or neither field is set.

**Env vars:** none read directly.

**Mount point:** first in the chain, before everything else — every request (including admin/webhook/portal routes) gets a request ID and logger regardless of auth outcome.

---

## tenant-auth.js

**Exports:** `init(deps)`, `loadEmployeePerms`, `loadTenantAndPerms`, `resolveTenant`, `loadCompanyProfile`, `resolveEffectiveRole`, `resolveContext`, `invalidateCompanyProfileCache`

`init(deps)` requires `{ db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore }`. Also fires `_warmCaches()` internally for single-tenant mode only — eagerly loads the company profile row and the `context_header_enforced` flag at boot, and prints a `SETUP URL` console banner if `setup_complete` is falsy.

Two per-tenant in-memory `Map` caches, both keyed by `req.tenantId` (or `"_default"` in ST mode):
- Company profile — `COMPANY_CACHE_MS = 5 * 60 * 1000` (5 min), stale-while-revalidate after warm-up.
- Context-enforcement flag — `CONTEXT_FLAG_CACHE_MS = 30000` (30s) — separate cache from `feature-flags.js`'s own flag cache.

### `loadEmployeePerms(req, res, next)`
Header-only fallback path (no JWT). Reads `x-employee-id`; must parse as an integer in `(0, 999999]` or 400 `{ error: "Invalid employee ID header" }`. Queries `employees` + `role_permissions` against the plain `db` handle directly (not tenant-proxied — assumes single-tenant). Any miss or thrown error → `req.employeePerms = []`, still calls `next()`. Never sets `req.employee`/`req.tenantId`.

### `loadTenantAndPerms(req, res, next)`
Primary JWT auth. No `Authorization: Bearer` header → `req.employeePerms = []`, calls `next()` without rejecting (many routes rely on this fall-through and gate themselves via their own `requirePerm`).

With a token, verifies via `jwt-auth.js:verifyAccessToken(token, process.env.JWT_SECRET)`.

**Scope gate (PLAN-V3 Step 4.3)** — runs *immediately after* verify and *before* any `req.tenantId`/`req.employee` assignment: a token with an explicit non-`"full"` scope → 401 `{ code: "INVALID_TOKEN_SCOPE" }`, and **no tenant context attaches**. Every legitimate employee token carries scope `"full"` (`jwt-auth.js:signAccessToken` defaults it; login/refresh/update-context and the impersonation mint in `routes/admin/operations.js` all produce `"full"`). Portal tokens carry `"customer"`/`"manufacturer"` and share `JWT_SECRET` when their dedicated portal secret is unset, so they verify here — the gate stops a portal token's `tid` from attaching tenant DB context to an *unguarded* tenant route (guarded routes already 403 because a portal token has no `eid` → empty perms). The check is `decoded.scope && decoded.scope !== "full"`: a **missing** scope is tolerated as legacy-employee (portal tokens always set scope, so tolerating absent scope doesn't reopen the hole), which avoids 401ing any in-flight scope-less token. This lands *before* `PERMISSION_RULES` (the blanket middleware) — verify a normal employee/impersonation token is unaffected before touching it. Mirror of the scope rejection the portal auth modules already do.

Then sets:
- `req.tenantId` (`decoded.tid`), `req.employee = { id, role_id }` (name/email backfilled below), `req.isImpersonating` + `req.impersonatedBy` (only when true)
- `req.jwtOid` — the JWT `oid` claim or `null`. This is the *only* remaining place that surfaces the JWT outlet claim; `outlet-context.js` is the sole consumer/interpreter of it plus the `x-outlet-id` header.
- `req.headers["x-employee-id"]` backfilled from `decoded.eid` — a compatibility bridge for any code still reading the header directly.

**Revocation checks** (permission DB queried in MT mode via `tenantDbManager.getDb(decoded.tid)`):
- `token_jti` present in `revoked_tokens` → 401 `{ code: "TOKEN_REVOKED" }`.
- Impersonation tokens additionally cross-check `public.impersonation_sessions.revoked_at IS NOT NULL` for the same `jti` (belt-and-suspenders — the revoke insert on impersonation-end is best-effort and can silently fail) → 401 `{ code: "TOKEN_REVOKED" }`.
- `employees.tokens_revoked_before` vs `decoded.iat` → 401 `{ code: "ALL_SESSIONS_REVOKED" }`.
- Missing table/column here is swallowed (pre-migration tolerance), not surfaced as a failure.

**Permission load**: one retry (100ms delay) on a thrown query error; if both attempts fail → 503 `{ code: "PERM_LOAD_FAILED" }` — deliberately not a silent empty-perms fallback (that used to masquerade as a misleading 403 for Admins under pool pressure). On success, the **DB-fresh `role_id` overwrites `req.employee.role_id`** (not the token's `rid`) — `resolveEffectiveRole` later compares the override role against this fresh value, and a stale token `rid` would let a restricting per-outlet override silently no-op.

**Decode errors**: `TokenExpiredError` → 401 `{ code: "TOKEN_EXPIRED" }`; `JsonWebTokenError`/`NotBeforeError` → 401 `{ code: "INVALID_TOKEN" }`; anything else → logged then 401 `{ code: "AUTH_FAILED" }` (a silent pass-through here used to surface downstream as a 500 from the tenant DB proxy having no async context).

Impersonation appends `" (impersonated by Super-Admin)"` to `req.employee.name`.

### `resolveTenant(req, res, next)`
No-op in single-tenant mode. In MT mode, resolves a tenant ID from `req.tenantId`, OR from `?tenant=<slug>` — **only** if the path matches `PUBLIC_TENANT_PARAM_PATHS`: `/api/auth/*`, `/api/attendance/pin-*`, `/api/feature-flags*`, `/api/setup/*`, `/api/health*`, `/api/company-profile/currency` (exact), `/api/billing/pricing` (exact). This allowlist exists specifically so an unauthenticated caller can't attach a tenant DB scope to any route lacking its own permission guard by appending `?tenant=foo`.

- No tenant ID resolved + path starts with `/api/` + not on the allowlist → 401 `{ code: "AUTH_REQUIRED" }` (clean failure instead of a downstream 500 from the async-context-less proxy).
- Otherwise: `tenantDbManager.getDb(tenantId)`, looks up the tenant row via `master-db-pg.js:getTenantById`, then `asyncStore.run({ db: tenantDb }, () => next())` — this wires the AsyncLocalStorage context that makes `deps.db` (the proxy in `tenant-db-proxy-pg.js`) route to the right schema for the rest of the request.
- Sets `req.tenantSlug`, `req.tenantDir` (`backend/tenants/t_<slug>`, consumed by `tenant-multer.js`).
- Errors: `TENANT_NOT_FOUND` (403, row missing), `TENANT_SUSPENDED` (403, message contains "is suspended"), `TENANT_DELETED` (403, message contains "is deleted"), else 500.

### `loadCompanyProfile(req, res, next)`
Reads `SELECT * FROM company_profile WHERE id = 1` via `_getCompanyDb(req)` (picks `dbProxy` in MT mode when `req.tenantId` is set, else plain `db`).
- Cold start: sets a synchronous `_placeholder` entry (`{ timezone: "UTC" }`) and **awaits** the first real load inline — avoids a race where the post-signup-wizard auto-login (or first request after a restart) hits the placeholder and gets wrongly bounced with `SETUP_REQUIRED`.
- Warm entries refresh stale-while-revalidate once `COMPANY_CACHE_MS` elapses (fire-and-forget; stale value served immediately).
- Sets `req.company` to the full row.
- 503 `{ code: "SETUP_REQUIRED" }` when the loaded (non-placeholder) profile has falsy `setup_complete`, path isn't `/api/setup*`/`/api/health*`, and (MT mode) `req.tenantId` is set.
- `invalidateCompanyProfileCache(tenantIdOrSlug)` — call after setup-complete/profile edits. Pass nothing to clear the whole cache.

### `resolveEffectiveRole(req, res, next)`
Per-outlet role resolution. Mounts AFTER `outlet-context.js`'s `resolveOutletContext` (needs its `overrideRoleId`) and BEFORE `resolveContext` (the first consumer of effective perms).

- Always preserves `req.baseEmployeePerms = req.employeePerms` for any request where perms is an array. Sets `req.employee.base_role_id`/`effective_role_id` when `req.employee` exists.
- `overrideRoleId = req.outletContext?.overrideRoleId`. If it's null/falsy or equals the base role id → `next()` with **zero extra queries** (effective = base).
- Otherwise loads `role_permissions` for the override role (same one-retry/503-`PERM_LOAD_FAILED` posture as `loadTenantAndPerms` — a silent empty-perms fallback here would demote an overridden Manager to nothing). On success, swaps `req.employeePerms` to the override role's set and sets `req.effectiveOverrideRoleId` (a req-level flag independent of `req.employee`, since the header-based ST auth path never sets that).
- **Invariant**: outlet *reach* (which outlets a principal may act at) must key on `req.baseEmployeePerms` — an override can grant *capability* at an outlet but never widen which outlets are reachable. `outlet-context.js`'s `enforceOutletAssignment` reads base perms for exactly this reason.
- No permission cache anywhere in this chain — add/remove of an override takes effect on the very next request.
- A per-outlet override role carrying `all_access` is equivalent to tenant-admin capability whenever that outlet is the active request context (tenant-scoped admin endpoints accept any assigned outlet as context) — treat assigning an `all_access` override as making that employee a tenant admin.

### `resolveContext(req, res, next)`
- Reads `x-company-id`/`x-scope-mode` headers directly into `req.context`. `outletId` comes from `req.outletContext.outletId` (set by the shared resolver, mounted just before this) — falls back to a raw `x-outlet-id` header read only when `req.outletContext` is `undefined` (standalone/unit-test usage without the resolver mounted).
- Enforcement flag (`context_header_enforced`) uses its own 30s cache, independent of `feature-flags.js`.
- When enforced and path is under `/api/`: `CONTEXT_EXEMPT_PATHS` (`/api/auth/*`, `/api/context/*`, `/api/feature-flags*`, `/api/attendance/pin-*`, `/api/roles/:id/permissions`, `/api/outlets` exact) skip the check. No `x-employee-id` header → passes through silently (relies on downstream auth to reject). A non-admin employee (no `all_access`) with no outlet resolved → 428 `{ code: "CONTEXT_REQUIRED" }`.

**`req.*` set across the full chain:** `req.tenantId`, `req.tenantSlug`, `req.tenantDir`, `req.employee`, `req.employeePerms`, `req.baseEmployeePerms`, `req.isImpersonating`, `req.impersonatedBy`, `req.jwtOid`, `req.company`, `req.effectiveOverrideRoleId`, `req.context`

**Env vars:** `JWT_SECRET`, `MULTI_TENANT` (passed through `init` as `IS_MULTI_TENANT`)

**Mount order:** `loadTenantAndPerms` → `resolveTenant` → (tenant `/uploads` static) → `loadCompanyProfile` → `resolveOutletContext` (`outlet-context.js`) → `resolveEffectiveRole` → `resolveContext`.

---

## outlet-context.js

The single validated interpreter of "which outlet is this request acting in." Precedence: validated `x-outlet-id` header → JWT `oid` claim (`req.jwtOid`) → none.

**Exports:** `init(deps)`, `resolveOutletContext()` (factory, returns middleware), `enforceOutletAssignment()` (factory, returns middleware), `resolveRequestedOutlet(args)` (pure async function, no req/res), `invalidateOutletCache(tenantId)`, `OutletContextError`

`init(deps)` requires `{ db, IS_MULTI_TENANT, dbProxy }`.

Per-tenant outlets cache (`_outletCache`, keyed like the others): `Map(outletId → outlet_type)`, `OUTLET_CACHE_MS = 60_000`. Only `is_active` outlets are included — inactive outlets are never valid context.

### `resolveRequestedOutlet({ db, cacheKey, headerValue, jwtOid, employeeId, skipAssignment })`
Pure function, throws `OutletContextError` (has `.statusCode`/`.code`) on invalid **explicit** header input; a stale JWT `oid` degrades silently to `{ outletId: null, source: "none" }` instead of throwing (it's a server-minted claim, not client input — outlet-scoped fail-closed gates downstream still catch operational routes).

Validation:
- Header set but not a positive integer → 400 `INVALID_OUTLET_CONTEXT`.
- Header integer not found in the active-outlets map → 403 `INVALID_OUTLET_CONTEXT` (same code as malformed input, deliberately, so a foreign/nonexistent id can't be distinguished from a bad format — no existence leak).
- Header outlet exists but employee isn't assigned (`employee_outlets` row absent) and `skipAssignment` is false → 403 `OUTLET_NOT_ASSIGNED`.
- No header, falls back to `jwtOid`: only resolves if the outlet exists AND (`skipAssignment` OR an assignment row exists); otherwise `{ outletId: null, source: "none" }`.
- Returns `{ outletId, source: "header"|"jwt"|"none", overrideRoleId }` — `overrideRoleId` is `employee_outlets.role_id` for the resolved outlet (`null` = inherit base role), read via `_getAssignment()` which degrades gracefully (Postgres error code `42703`, undefined column) on pre-migration schemas lacking the column.

`skipAssignment` **must** be computed from base perms (`all_access` or `execute_field_sales`) — never from effective/overridden perms, so a per-outlet override can never widen which outlets a principal reaches.

### `resolveOutletContext()` (middleware factory)
Sets `req.outletContext = { outletId: null, source: "none", overrideRoleId: null }` unconditionally first. No-ops (leaves the default) for non-`/api/` paths, for MT mode with no `req.tenantId` (a public `?tenant=` path — nothing to validate an outlet against), and when there's no `x-employee-id` header. Otherwise calls `resolveRequestedOutlet(...)`, catching `OutletContextError` → `res.status(err.statusCode).json({ error, code })`, any other throw → 500.

### `enforceOutletAssignment()` (middleware factory)
Outlet-assignment enforcement for non-admin employees, independent of (but consistent with) the resolver's own check — validates explicit `outlet_id` in query/body params too.
- No-ops for non-`/api/` paths, `/api/attendance/pin-*` (kiosk PIN routes — PIN is the auth), and requests with no `x-employee-id`.
- Reads `req.baseEmployeePerms || req.employeePerms` (base-perms-first, since this runs after `resolveEffectiveRole` on the full chain) — `all_access` or `execute_field_sales` (field reps are tenant-scoped, never have `employee_outlets` rows) skip entirely.
- Precedence for which outlet id to check: `req.outletContext.outletId` (already validated by the resolver — passes immediately) → `req.query.outlet_id` → `req.body.outlet_id`. Exactly one id is checked per request. A query/body id not matching the already-validated context outlet triggers a fresh `_isAssigned()` check → 403 `{ error: "Forbidden: outlet is not assigned to this employee account." }` if unassigned.

**Env vars:** none directly (`MULTI_TENANT` via `init`).

---

## permissions.js

**Exports:** `requirePerm`, `requireAnyPerm`, `requireContextOutlet`, `DEFAULT_ROLE_PERMISSIONS`, `ensureDefaultRolePermissions`, `PERMISSION_RULES`

### `requirePerm(permission)` / `requireAnyPerm(permissions[])`
Both read `req.employeePerms || []`. `"all_access"` bypasses. `requireAnyPerm` passes on any one match. Both 403 `{ error: "Forbidden: insufficient permissions" }` on failure.

### `requireContextOutlet(req, res, next)`
Backfills `req.query.outlet_id` from `req.context?.outletId` only if the query param is absent. Always calls `next()`.

### `DEFAULT_ROLE_PERMISSIONS`
- `Administrator`: `["all_access"]`
- `Manager`: `manage_inventory`, `manage_orders`, all five `view_*_reports` (`sales`/`inventory`/`financial`/`hr`/`customer`), `manage_employees`, `manage_finance`, `manage_reports`, `manage_customers`, `pos_discount`, `void_sales`, `pos_park`, `pos_void`, `manage_restaurant`, `manage_kds`, `manage_bookings`, `manage_projects`, `manage_contracts`, `manage_tickets`, `manage_rentals`, `manage_rooms`, `manage_treatment_plans`, `manage_tips`, `override_void_comp`, `manage_gift_cards`, `override_price`, `override_credit_limit`, `manage_field_sales`, `manage_forms`
- `Cashier`: `["view_sales_reports", "pos_discount", "pos_park"]`
- `"Field Rep"`: `["execute_field_sales"]` only — scoping to "only this rep's own route/check-ins" is enforced in route handlers, not here.

### `ensureDefaultRolePermissions(db)`
Async, idempotent. For each role name in `DEFAULT_ROLE_PERMISSIONS` found in the tenant's `roles` table, `INSERT ... ON CONFLICT DO NOTHING` each permission into `role_permissions`. Logs and swallows errors instead of throwing — safe to call repeatedly (provisioning, backfills). This constant is the durable source of truth: re-running this function will re-seed permissions that were removed directly from the `role_permissions` table.

### `PERMISSION_RULES`
Declarative array of `{ methods: string[], path: RegExp, anyPerms: string[] }` covering reports, attendance, categories/brands/products/attribute-sets/barcode templates & print jobs/expenses & expense-categories, outlets, receipt-templates, suppliers/supplier-returns/supplier-invoice-pay, returns, approvals, PO/transfer submit+approve, parked sales, each Phase-4 vertical prefix (restaurant, KDS, booking-services, appointments, projects, contracts, service-tickets, rental-items/contracts, room-types/rooms/room-bookings, the treatment-plans cluster, tips), and `/api/business-modules`.

**This is live middleware, not a reference table.** `registerAllRoutes.js` mounts it as a blanket `app.use()` over every `/api/` request, after outlet-assignment enforcement and before every route module.

- `PERMISSION_RULES.find(r => r.methods.includes(req.method) && r.path.test(req.path))` — **first match wins**; no match → `next()` (allowlist of guarded prefixes, not a deny-by-default gate).
- Passes on `all_access` or any one of the rule's `anyPerms`; else 403 `{ error: "Forbidden: insufficient permissions" }`.
- Reads **effective** perms (`resolveEffectiveRole` has already run), so a per-outlet role override is honoured here.
- Does **not** replace per-route `requirePerm`/`requireAnyPerm` — both apply, and this runs first. A route's own guard can never be looser than the blanket rule covering its prefix.

**Two traps that follow from "prefix regex + runs first":**
1. **Self-scoped sub-endpoints get caught by their parent prefix.** A rule on `/^\/api\/attendance(\/|$)/` also matches `attendance/my-status`; tightening that rule's `anyPerms` will 403 an endpoint meant to be self-serve (this is exactly how the POS shift gate broke once — see the attendance rule's explicit negative-lookahead carve-out for `my-status`). When changing a rule, enumerate every sub-path under its regex.
2. **A "public" GET under a guarded prefix silently 403s unauthenticated callers.** The kiosk endpoints under `/api/attendance` (`pin-status`, `pin-checkin`, `pin-outlets`) are all POST specifically because the attendance rule only lists `GET` in its `methods` — easy to miss when testing while already logged in.

The `/api/business-modules` rule accepts either `manage_business_modules` or `manage_outlet_modules` as a gateway for the whole prefix — per-route guards then enforce the finer split (company-level toggle needs `manage_business_modules` specifically; read/impact/per-outlet-toggle accept either).

**`req.*` read:** `req.employeePerms`, `req.context`

---

## feature-flags.js

**Exports:** `init(deps)`, `DEFAULT_FEATURE_FLAGS`, `getFeatureFlagsMap`, `getEffectiveFlagsMap`, `getModesMap`, `getEffectiveModesMap`, `isModuleOffAtOutlet`, `outletCardForFlag`, `invalidateFeatureFlagCache`, `invalidateModeCache`, `requireFeature`, `requireMode`, `createNotification`, `notifyLowStockForSale`

`init(deps)` requires `{ db, IS_MULTI_TENANT, tenantDbManager, dbProxy }`; also derives `_notifDb = IS_MULTI_TENANT ? dbProxy : db` for the notification helpers below.

Imports `BUSINESS_MODULES` from `config/business-modules.js` at load time (no top-level requires there, so this is cycle-safe even though `services/business-modules.js` requires this file back lazily) and builds two static lookup maps at module load: `OUTLET_FLAG_TO_CARD` (flag key or sub_toggle key → card key) and `OUTLET_MODE_TO_CARD` (mode name → card key), covering only cards with `scope === "outlet"`.

### `DEFAULT_FEATURE_FLAGS`
A large static `{ key: boolean }` map — the fallback layer under whatever the tenant's `feature_flags` table actually has. Core-spine keys (`accounting_core`, `approvals`, `notifications`, `crm_quotations`, `advanced_hr`, `multi_company`, etc.) default `true`; nearly every vertical/tier addition (restaurant, appointments, rentals, room management, treatment plans, wholesale, phase2-G, phase5 Pakistan integrations, kit/BOM, batch/expiry, etc.) defaults `false` and is flipped on per-tenant by the setup wizard or a migration backfill matching the chosen preset — never globally. A few additive/backward-safe UI flags default `true` (e.g. `receipt_designer_v2`).

**Known drift points** (verify the live DB row before trusting this map's default):
- `fbr_integration` is **not** in this map at all — DB-seeded by its own migration; a brand-new tenant row is what determines its state.
- `ai_insights` defaults `true` here, but `routes/insights-ai.js` reads the DB row directly as a soft gate instead of calling `requireFeature()` — this file's default only affects what the admin flags editor shows before a DB row exists.
- Shopify routes gate on an active-connection check, not a feature flag.

### `_getBundle(tenantId)` (internal)
One 60s-cached (`FEATURE_FLAG_CACHE_MS`) fetch per tenant that loads **three** things together in a single cache fill: the merged flags map (`feature_flags` table over `DEFAULT_FEATURE_FLAGS`), `outlet_business_modules` overrides (`Map("outletId:cardKey" → bool)`), and `tenant_business_modules.default_outlet_enabled` per-card defaults (`Map(cardKey → bool)`). Missing-relation errors (pre-migration/pared-down test schemas) are tolerated per-query and yield empty maps rather than throwing; if `init()` was never called (bare test harness with no `db`), returns all-defaults uncached.

`getFeatureFlagsMap(tenantId)` is a thin wrapper returning just the flags half of the bundle (company-level truth, used by the flags editor).

### `getEffectiveFlagsMap(tenantId, outletId)`
Applies the per-outlet overlay: for every flag mapped to an outlet-scoped card, if the flag is company-`true` but resolves `false` at `outletId` (via `_outletResolved`: `override ?? default_outlet_enabled ?? true`), the effective value flips to `false`. No `outletId` → returns the plain company-level map unchanged. Used by `GET /api/feature-flags`'s `effective` field, context bootstrap, and outlet-bound public surfaces.

### `isModuleOffAtOutlet(tenantId, cardKey, outletId)`
Pure per-outlet resolution for one card (override ?? default ?? true), deliberately **not** composed with company-level state — the caller composes the company flag itself. Returns `false` immediately if the card isn't `scope: "outlet"` or doesn't exist. Its one consumer, `public-restaurant.js:kioskOrderingOff()`, ANDs the company-level `phase4_restaurant` flag with this so the QR kiosk goes dark when Restaurant is off **either** company-wide **or** at the outlet (PLAN-V3 E9).

### `getEffectiveModesMap(tenantId, outletId)` / `outletCardForFlag(flagKey)`
`getEffectiveModesMap` mirrors `getEffectiveFlagsMap` for the outlet-scoped Bucket-A modes. `outletCardForFlag` is a plain lookup into `OUTLET_FLAG_TO_CARD`.

### `requireFeature(flagKey, opts = {})`
Returns async middleware. Company-level check first: flag off → 403 `{ error: "Feature disabled: <key>", flag: <key> }` (deliberately 403, not 503 — "feature off" is a permission-style refusal, not a service outage; 503 was generating alert noise on routine capability probes). Unexpected DB error → 500.

If `flagKey` maps to an outlet-scoped card (and `opts.companyLevel` is not set), also runs the shared `_outletGate` check:
- `req.outletContext === undefined` (resolver not mounted on this chain — portal/public routes, bare test harnesses) → skip, company-level only (pre-outlet-gating behavior preserved).
- Outlet resolved and card resolves `false` there → 403 `{ ...body, outlet_scoped: true, outlet_id }`.
- No outlet resolved: `all_access` falls back to company-level (admins can toggle modules anyway); everyone else → 403 `{ code: "OUTLET_CONTEXT_REQUIRED" }`.

**`opts.companyLevel: true`** is the explicit escape hatch — the call site always evaluates company-level state even when an outlet resolves. Used by settings/config surfaces and cross-outlet reports that must stay readable regardless of the viewer's outlet-level module state (each call site should carry a comment explaining why).

### `getModesMap(tenantId)`
Same 60s-cache pattern (`MODE_CACHE_MS`) against `tenant_modes`. Returns `{}` — not a throw — if `init()` was never called, if the table doesn't exist, or on any other tolerated condition. This return value directly feeds `requireMode`'s fail-closed branch below.

### `requireMode(modeName, opts = {})`
Returns async middleware. **Fail-closed on an empty mode map**: calls `reportEmptyModes()` (Sentry `captureMessage` + `logger.warn`, both swallow their own errors; entirely skipped when `NODE_ENV === "test"`) then refuses 403 `{ code: "MODES_NOT_SEEDED", mode }` — deliberately distinct from the plain "mode off" refusal so ops can tell a seeding failure from a mode that's legitimately disabled. Otherwise: mode present but `false` → 403 `{ error: "Mode not enabled: <name>", mode }` (no `code`). Mode `true` → runs the same `_outletGate` per-outlet check as `requireFeature` when the mode maps to an outlet-scoped card and `req.outletContext !== undefined`.

The `catch` block's "table does not exist" fallthrough is effectively vestigial for `tenant_modes` itself (already swallowed inside `getModesMap`) — it remains reachable only via a missing-table error surfacing from the outlet-gating bundle fetch on a partially-migrated schema.

### `invalidateFeatureFlagCache(tenantId)` / `invalidateModeCache(tenantId)`
Bust one tenant's cache, or the whole cache if `tenantId` is falsy. Call after any admin flag/mode/module-toggle mutation (the bundle cache and mode cache are separate — a module toggle typically needs to bust both).

### `createNotification(type, title, message, link)`
Fire-and-forget `INSERT INTO notifications`; errors swallowed via `.catch(() => {})`.

### `notifyLowStockForSale(cartItems, outletId)`
Dedupes product ids out of cart line items (checks `original_product_id`, then `product_id`, then `id`), queries `outlet_stock` joined to `products` for rows with quantity ≤ 10 at `outletId`, fires a `low_stock` notification per match. No-ops if `outletId` or the product list is empty. Fire-and-forget.

**`req.*` read:** `req.tenantId`, `req.outletContext`, `req.employeePerms`

**Env vars:** none read directly — DB handles and `IS_MULTI_TENANT` all come through `init(deps)`.

---

## plan-limits.js

**Exports:** `requirePlanLimit`, `requireActiveSubscription`, `PLAN_DEFAULTS`

### `requirePlanLimit(resource)`
`resource` must be `"employees"`, `"outlets"`, or `"products"` — anything else throws synchronously at middleware-construction time (route registration), not per-request.

Returns async middleware:
- No-op when `MULTI_TENANT !== "1"`, or when `req.tenantId` is absent (lets downstream auth reject).
- Reads `max_<resource>` off the `public.tenants` row (`master-db-pg.js`). `null` or `<= 0` → unlimited, passes.
- Counts current rows via the tenant-scoped DB (`tenant-db-manager-pg.js:getDb`). Employees/products exclude `deleted_at IS NOT NULL`; outlets exclude `outlet_type = 'van'` (vans are wholesale rep-stock buckets, not sellable locations, so they're exempt from the cap by design — `COALESCE(outlet_type, 'store')` keeps legacy NULL rows counting as stores).
- At/over the limit → 403 `{ error, code: "PLAN_LIMIT_REACHED", limit, current }`.
- Any lookup failure → best-effort `next()` — never blocks purely because the check itself failed.

### `requireActiveSubscription(req, res, next)`
Synchronous function body — the DB check runs via `.then()`/`.catch()`, not `await`, so the outer function returns before it resolves. Don't wrap a call site expecting a thrown error from this function.
- No-op for `GET`/`OPTIONS`/`HEAD`, ST mode, and paths under `/api/auth/`, `/api/billing/`, `/api/support/`, `/api/setup/`, `/api/health`, `/api/receipts/`.
- No-op if `req.tenantId` is absent.
- Free-plan tenants are never blocked, even if `payment_status` has drifted.
- `payment_status === "expired"` → 403 `{ error, code: "SUBSCRIPTION_EXPIRED", billing_url: "/billing" }`.
- Lookup failure → best-effort `next()`.

### `PLAN_DEFAULTS`
```js
{
  free: { max_outlets: 1, max_employees: 3, max_products: 100 },
  pro:  { max_outlets: 1, max_employees: 0, max_products: 0 },
}
```
`0`/`null` = unlimited. These are the values applied at tenant provisioning / plan change — the middleware always reads the tenant row's own columns live, never this constant.

**`req.*` read:** `req.tenantId`, `req.method`, `req.path`

**Env vars:** `MULTI_TENANT`

---

## rate-limit.js

All limiters are `express-rate-limit` instances sharing one `limitExceededHandler` → 429 with a `Retry-After` header (seconds) and body `{ error: "Too many requests", retry_after_seconds }`.

**Exports:** `globalLimiter`, `authLimiter`, `webhookLimiter`, `reviewLimiter`, `publicBookingLimiter`, `publicRestaurantLimiter`, `memberKioskLimiter`, `customerPortalAuthLimiter`, `customerPortalOtpLimiter`, `customerPortalDataLimiter`, `manufacturerPortalAuthLimiter`, `manufacturerPortalDataLimiter`, `pinValidateLimiter`, `adminTotpLimiter`

| Limiter | Window | Max | Key | Skipped in tests |
|---|---|---|---|---|
| `globalLimiter` | `RATE_LIMIT_WINDOW_MS` (default 60s) | `RATE_LIMIT_GLOBAL_MAX` (default 600) | `{tenantSlugOrSt}:{ip}` | n/a — `skip` exempts POS burst paths instead |
| `authLimiter` | 15 min | `RATE_LIMIT_AUTH_MAX` (default 20) | `{store_code or tenant slug}:{ip}` (ST: `req.ip` only) | yes |
| `webhookLimiter` | 60s | `RATE_LIMIT_WEBHOOK_MAX` (default 120) | default (IP) | no |
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

**`globalLimiter` skips** (`isPosBurstPath`): `/api/sales`, `/api/products/search`, `/api/products/scan/`, `/api/orders` — POS hot paths that would otherwise blow through the global cap during ordinary cashier usage.

**`pinValidateLimiter`** exists because the PIN-validate endpoint reveals "is this PIN any employee's PIN" — a 4-digit space is brute-forceable inside the global 600/min limit in roughly 17 minutes; 20/15min forces it out to years.

**`adminTotpLimiter`** is the tightest limiter in the file on purpose — it's the last gate before a super-admin session token is issued, and each attempt is a 6-digit/recovery-code guess.

**Env vars:** `MULTI_TENANT`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_WEBHOOK_MAX`, `RATE_LIMIT_MEMBER_KIOSK_MAX`, `NODE_ENV` (most non-global/auth limiters skip enforcement entirely under `NODE_ENV === 'test'`)

**Gotcha:** the portal limiters (customer + manufacturer) and the review/booking/restaurant/kiosk limiters all key on the `?tenant=` query param or `x-tenant-slug` header rather than `req.tenantSlug` — because they sit on routes mounted **before** `loadTenantAndPerms`/`resolveTenant` run, so `req.tenantSlug` isn't set yet at that point.

---

## validate.js

**Exports:** `{ validate }`

`validate(schema)` — factory. Returns middleware that calls `schema.parse(req.body || {})`.
- On success, **replaces** `req.body` with the parsed/coerced/stripped result — downstream handlers must not assume the raw body shape survives.
- On `ZodError` → 400 `{ error: "<first issue message>", details: [{ field, message }] }`. `field` is the dot-joined issue path (e.g. `"items.0.price"`). Reads `err.issues` with `err.errors` as a fallback (`??`) for older Zod.
- Any non-Zod error is forwarded via `next(err)`, not swallowed.

Schemas live in `backend/schemas/` — route files should never define Zod schemas inline.

---

## upload-validation.js

**Exports:** `imageFileFilter`, `rasterImageFileFilter`, `clinicalDocFileFilter`, `safeExtension`, `detectImageType`, `verifyImageMagicBytes`, `ALLOWED_IMAGE_MIMES`, `ALLOWED_IMAGE_EXTS`, `ALLOWED_RASTER_IMAGE_MIMES`, `ALLOWED_RASTER_IMAGE_EXTS`, `ALLOWED_CLINICAL_DOC_MIMES`, `ALLOWED_CLINICAL_DOC_EXTS`

Built on a shared internal factory `makeImageFileFilter(allowedMimes, allowedExts)` that checks both `file.mimetype` and the `path.extname` of `file.originalname` — used as a multer `fileFilter`.

- **`imageFileFilter`** — full allowlist incl. SVG (JPEG/PNG/GIF/WebP/SVG/BMP/TIFF). Use only for uploads that get rasterized (e.g. via `sharp`) before being served back — product images are the canonical case.
- **`rasterImageFileFilter`** — same set minus SVG. Use for anything stored as-is and served from a same-origin URL: an SVG can carry `<script>`/`onload` payloads that execute when fetched as a top-level document carrying the API's auth cookies. Support-ticket screenshot uploads use this.
- **`clinicalDocFileFilter`** — raster images + `application/pdf` + `text/plain`, no SVG. For treatment-plan document uploads (lab reports, referrals, imaging) that need non-image formats but must still exclude anything same-origin-executable.
- **`detectImageType(buffer)`** — magic-byte sniffer for JPEG, PNG, GIF, WebP, BMP, TIFF (both endiannesses), and PDF. Returns `null` for unrecognized bytes; cannot sniff SVG/plain-text (no magic bytes).
- **`verifyImageMagicBytes(buffer, claimedMime)`** — `true`/`false` comparing sniffed bytes vs claimed MIME; `text/plain` always passes (nothing to sniff). Call this **after** multer accepts a file, to catch a faked `Content-Type` (e.g. an executable renamed `.jpg` with a spoofed `image/jpeg` header).
- **`safeExtension(originalname, mimetype)`** — returns the original extension if allowlisted; else derives one from the MIME type; else defaults to `.png`.

No env vars.

---

## customer-auth.js

Customer portal JWT auth. Mounted **before** the employee tenant middleware chain — `req.employee`/`req.company` are never set on portal requests; tenant DB routing goes through `services/public-tenant-context.js:resolvePublicTenantDb()` instead of `resolveTenant`.

**Exports:** `loadCustomerAuth(deps)`, `signCustomerTokens(customer, tenant)`, `verifyCustomerToken(token)`, `hashRefreshToken(token)`, `getSecret()`

### `loadCustomerAuth(deps)`
Factory → async `customerAuth(req, res, next)`.
- 401 `"Missing bearer token"` if no `Authorization: Bearer` header.
- Verify failure → 401 `"Invalid or expired token"`.
- `payload.scope !== "customer"` → 401 `"Invalid token scope"` (blocks staff/manufacturer tokens from cross-authing). `payload.type === "refresh"` → 401 (refresh tokens can't be used as access tokens).
- Calls `resolvePublicTenantDb(req, deps)` (resolves tenant from `?tenant=`/`x-tenant-slug`), then cross-checks `payload.tid` against the resolved tenant's id → 401 `"Token does not match tenant"` on mismatch (blocks replaying a valid token for tenant A against tenant B's slug).
- 401 `"Customer not found"` if the row is missing or soft-deleted. `customers.portal_tokens_revoked_before` vs `payload.iat` → 401 `"Session revoked"` if the token predates the cursor (set on password reset/logout-all).

**Sets on `req`:** `req.customerId`, `req.tenantId`, `req.tenant` (`{ id, slug }`), `req.db` (tenant-scoped, returned directly by the resolver — **not** the ALS-proxied `deps.db`).

### `signCustomerTokens(customer, tenant)`
Returns `{ accessToken, refreshToken, refreshHash, refreshExpiresAt }`. Both tokens carry `{ cid, tid, tslug, scope: "customer", jti }` (refresh adds `type: "refresh"`). `refreshHash` (SHA-256 of the raw token) is what's persisted — the raw refresh token is never stored.

**Env vars:** `CUSTOMER_PORTAL_JWT_SECRET` (falls back to `JWT_SECRET` with a one-time console `[SECURITY]` warning, then to the hardcoded `"dev-insecure-secret"`), `CUSTOMER_PORTAL_ACCESS_TTL` (default `"30m"`), `CUSTOMER_PORTAL_REFRESH_TTL` (default `"30d"`)

---

## manufacturer-auth.js

Manufacturer partner portal JWT auth. Structurally near-identical to `customer-auth.js` — separate secret, separate scope, separate table — and mounted before the employee tenant middleware chain, also via `resolvePublicTenantDb()`.

**Exports:** `loadManufacturerAuth(deps)`, `signManufacturerTokens(partner, tenant)`, `verifyManufacturerToken(token)`, `hashRefreshToken(token)`, `getSecret()`

### `loadManufacturerAuth(deps)`
Mirrors `loadCustomerAuth`'s structure exactly (bearer required, scope must be `"manufacturer"`, refresh-as-access rejected, `resolvePublicTenantDb()` + cross-tenant `tid` check, revocation cursor), with one addition: looks up `manufacturer_partners` by `payload.mid` and additionally gates on partner `status` — `"suspended"` → 403 `"Partner access suspended"`; anything other than `"active"` → 401 `"Partner not active"`; missing row → 401 `"Manufacturer partner not found"`.

**Sets on `req`:** `req.manufacturerId`, `req.tenantId`, `req.tenant`, `req.db`.

### `signManufacturerTokens(partner, tenant)`
Same shape as `signCustomerTokens` but payload key is `mid` (not `cid`) and `scope: "manufacturer"`.

**Env vars:** `MANUFACTURER_PORTAL_JWT_SECRET` — **required in production** (PLAN-V3 4.3): `getSecret()` throws when it's unset under `NODE_ENV === "production"` instead of silently falling back to `JWT_SECRET`, and `boot/assert-secrets.js` refuses to boot production unless it's set, distinct from `JWT_SECRET`, and non-trivial. The `JWT_SECRET`/`dev-insecure-secret` fallback survives **only** under `NODE_ENV !== "production"` (dev/test), with a one-time `[SECURITY]` warning. `MANUFACTURER_PORTAL_ACCESS_TTL` (default `"15m"` — deliberately shorter than the customer portal's 30m, since manufacturer reports expose aggregate revenue/scheme data), `MANUFACTURER_PORTAL_REFRESH_TTL` (default `"30d"`). **Note the drift from `customer-auth.js`**: the customer portal still falls back to `JWT_SECRET` in production — the same latent issue, an intentional 4.3 follow-up, not yet fixed.

**Gotcha:** `customer-auth.js` and `manufacturer-auth.js` share the same token shape (principal id + `tid` + `tslug` + `scope` + `jti`), the same `resolvePublicTenantDb()` cross-tenant check, and the same revocation-cursor pattern — but they've drifted apart on TTL defaults and status-check details (only the manufacturer variant checks a `status` column). If you fix a bug in one — especially anything touching the `?tenant=` cross-tenant lockdown or revocation logic — check whether the same bug exists in the other.

---

## Application order (full picture)

```
requestId                          ← first; gives every request req.log + req.id
globalLimiter                      ← before route mounting

[admin routes (routes/admin/) mount here — no tenant context]
[webhook routes (routes/webhooks.js) mount here — no auth except HMAC on /api/webhooks/xpay]
[customer portal routes: customerPortalAuthLimiter/customerPortalOtpLimiter/customerPortalDataLimiter → loadCustomerAuth(deps) → handler]
[manufacturer portal routes: manufacturerPortalAuthLimiter/manufacturerPortalDataLimiter → loadManufacturerAuth(deps) → handler]

authLimiter                        ← applied to /api/auth/* routes specifically
loadTenantAndPerms                 ← req.employee, req.employeePerms, req.tenantId, req.jwtOid
enrichReqLog                       ← (request-id.js) re-binds req.log with tenant/employee, optional
resolveTenant                      ← req.tenantSlug, asyncStore context wired, deps.db proxy now live
[tenant /uploads static]
loadCompanyProfile                 ← req.company (needs resolveTenant's tenant context in MT)
resolveOutletContext               ← (outlet-context.js) validated x-outlet-id → jwtOid → none; req.outletContext (+overrideRoleId)
resolveEffectiveRole               ← (tenant-auth.js) per-outlet role override → swaps req.employeePerms; req.baseEmployeePerms preserved
resolveContext                     ← req.context (consumes req.outletContext + x-company-id/x-scope-mode + context_header_enforced flag)

[all tenant business routes mount here]

requirePerm / requireAnyPerm       ← per-route (permissions.js)
requireFeature / requireMode       ← per-route (feature-flags.js)
validate(schema)                   ← per-route body validation (validate.js)
requirePlanLimit(resource)         ← per-route, POST/creation endpoints only (plan-limits.js)
requireActiveSubscription          ← per-route or globally on write verbs (plan-limits.js)
```

**Portal routes (customer + manufacturer) are structurally separate chains** — they never pass through `loadTenantAndPerms`/`resolveTenant`/`loadCompanyProfile`/`resolveContext`. Don't assume `req.employee`, `req.company`, or the ALS-proxied `deps.db` are available in portal route handlers; use `req.db` (set directly by the portal auth middleware) instead.
