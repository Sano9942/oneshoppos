# Subsystem Audit 06 — Cross-Cutting Security Posture

> **RAW EVIDENCE — read with care.**
> Produced by a read-only source-code audit on **2026-07-29** at commit **`3b84732d`**.
> Findings are graded **REPORTED** unless the [main report](../01-architecture-report.md) marks them CONFIRMED.
> Where this document and the main report disagree, **the main report wins**.
> Line numbers drift: **grep the named symbol, don't trust the number.**
>
> This audit documents **mechanisms and provable gaps**. It does not contain exploit guidance.

---

## 1. Authentication

### JWT mechanics (`backend/jwt-auth.js`)
- **Access tokens:** HS-signed, payload `{tid, eid, rid, oid, scope: "full" (default), jti: crypto.randomUUID()}`, default TTL **24 h** (`JWT_EXPIRES_IN`, :10-27)
- **Refresh tokens:** **7 d** default, `{tid, eid, type: "refresh"}`, **SHA-256-hashed before DB storage**; the raw token only ever leaves in an httpOnly cookie (:36-47). Cookie set at `routes/auth.js:604-610` — `httpOnly, secure` in prod, `sameSite: "None"` in prod, path-scoped to `/api/auth`

### Refresh rotation with reuse detection (`routes/auth.js:510-619`)
Lookup by hash *without* filtering revoked rows, so reuse is **distinguishable**; presenting a revoked token **revokes the whole family** for that employee+tenant (:548-556). New token inserted before old revoked (ordering deliberate, :577-591). Admin refresh has an identical rotate-and-family-revoke design (`routes/admin/auth.js:294-345`).

### Scope isolation between five token families
Families: tenant employee `"full"`, admin `"admin"`, admin-2FA-pending `"admin_totp_pending"`, customer `"customer"`, manufacturer `"manufacturer"`.

`loadTenantAndPerms` rejects any explicit non-`"full"` scope with **401 `INVALID_TOKEN_SCOPE`** *before* attaching `req.tenantId` (`middleware/tenant-auth.js:109-111`). A missing scope is tolerated as legacy — portal/admin tokens always set scope, so this doesn't reopen the hole, but a hypothetically forged scope-less token signed with `JWT_SECRET` would be treated as an employee token (moot unless the secret leaks). Portal middlewares reject non-matching scope **and** refresh-as-access (`customer-auth.js:113-118`).

### Secret management
- **No `JWT_SECRET` fallback** in the employee path — `routes/auth.js:393-395` hard-fails with 500 if unset
- **Portal secrets are fail-closed at boot in production** — `boot/assert-secrets.js` kills boot unless both `MANUFACTURER_PORTAL_JWT_SECRET` and `CUSTOMER_PORTAL_JWT_SECRET` are set, ≥32 chars, ≥12 distinct chars, not known placeholders, differ from `JWT_SECRET` **and from each other** (:26-118)
- Dev/test fallback to `JWT_SECRET`/`"dev-insecure-secret"` survives only outside production, with a `[SECURITY]` warning (`customer-auth.js:23-42`, `manufacturer-auth.js:26-44`)
- ⚠️ **Admin tokens are signed with `JWT_SECRET`** (`admin/auth.js:54-57`) and rely on the scope gate + `role === 'super_admin'` for separation — no dedicated admin key

### Revocation
Per-token `jti` checked against tenant `revoked_tokens`; per-employee `tokens_revoked_before` cursor vs `iat`; impersonation tokens additionally cross-checked against `public.impersonation_sessions.revoked_at` (`tenant-auth.js:135-166`).
⚠️ **Caveat:** the whole revocation block sits inside a `try/catch` that silently skips if tables/columns are missing (:167-169) — pre-migration tolerance that **also masks a genuine query failure**.

### Password / PIN hashing
bcryptjs, **10 rounds everywhere** (hard-coded: `routes/employees.js:94-95, 419, 458`; `routes/auth.js:694, 756, 890`; `BCRYPT_ROUNDS = 10` in `seed-admin-pg.js:12`, `routes/admin/helpers.js:6`, `tenant-provisioner-pg.js:16`, both portal auth files).

⚠️ **A plaintext-PIN legacy fallback survives on read paths** — kiosk PIN resolution compares `String(row.pin_code) === String(pin)` when no hash exists (`routes/attendance.js:44-62`), and manager-PIN override does the same (`services/manager-pin.js:46`). Pre-v14 rows therefore remain plaintext at rest and are compared **non-constant-time**.

### Admin login (`routes/admin/auth.js`)
bcrypt password step → optional TOTP second step via a 5-minute `admin_totp_pending` JWT that `requireSuperAdmin` rejects everywhere else (:106-114, 141-143); TOTP endpoint behind `adminTotpLimiter` (5/15 min/IP); single-use **bcrypt-hashed recovery codes** burned on use (:155-167); new-IP login alert email (:118-121, 175-179); all outcomes written to `admin_security_log`. Access 1 h / refresh 7 d rotating, hashed in `admin_sessions`, httpOnly cookie path-scoped to `/api/admin/auth`.
⚠️ **No account lockout** on repeated password failures — throttling is `authLimiter` only (20/15 min keyed per store-code+IP).

### Impersonation (`routes/admin/operations.js:152-239`)
1 h JWT, scope `"full"`, `impersonating: true` + `realIdentity`, per-token `jti` recorded in `impersonation_sessions`. `/end` inserts the jti into the tenant's `revoked_tokens` **best-effort** (failure logged, not fatal, :222-235) — the registry-side `revoked_at` cross-check (`tenant-auth.js:150-158`) is the backstop. Manager-PIN self-approval is **hard-refused under impersonation** (`services/manager-pin.js:1-13`).

---

## 2. Authorization & tenant isolation

### Two guard layers
Per-route `requirePerm`/`requireAnyPerm` (`middleware/permissions.js:5-28` — `all_access` bypasses, 403 otherwise) **plus** a blanket `PERMISSION_RULES` regex array mounted as `app.use()` before route modules (first-match-wins; **no match falls through** — an allowlist of guarded prefixes, not deny-by-default). Default roles at `:37-105` (Administrator = `all_access` only; Cashier = 3 perms; Field Rep = 1). `ensureDefaultRolePermissions` re-seeds idempotently (:107-120).

### Per-outlet role overrides (`resolveEffectiveRole`, `tenant-auth.js:371-421`)
Base perms always preserved in `req.baseEmployeePerms`; override perms loaded **per-request (no cache)**, so revocation is effective on the very next request; fail-closed **503 `PERM_LOAD_FAILED`** after one retry rather than a silent empty-perms demotion.

**The invariant** — "reach keys on base perms, capability on effective" — is enforced in the resolver: `skipAssignment` must be computed from base perms (`outlet-context.js:100-108`).

### Outlet context (`middleware/outlet-context.js`)
Single validated interpreter of `x-outlet-id` → JWT `oid` → none. Malformed header → 400; nonexistent/foreign outlet → 403 with the *same* code `INVALID_OUTLET_CONTEXT` (**deliberate no-existence-leak**, :110-132); unassigned non-admin → 403 `OUTLET_NOT_ASSIGNED`; stale JWT `oid` degrades to none rather than rejecting (server-minted claim). 60 s cache; inactive outlets excluded.

### Tenant isolation mechanics
`tenant-db-manager-pg.js` wraps *every* query/transaction in:
```sql
BEGIN;  SET LOCAL search_path TO 'tenant_<slug>', public;  …;  COMMIT;
```
(:57-89). `SET LOCAL` + explicit transaction pins the search_path to one backend under Supavisor transaction pooling and **auto-reverts at COMMIT**, so a released connection cannot carry a tenant search_path into another request. Master DB queries do the mirror-image (`master-db-pg.js:223-231`). The `deps.db` Proxy **throws** if no tenant context exists (`tenant-db-proxy-pg.js:16-22`) — fail-closed, no default-schema fallback.

### `?tenant=` lockdown
`resolveTenant` only honours the slug param on an explicit allowlist (`tenant-auth.js:28-36`); any other `/api/` request with no JWT-derived tenant gets 401 `AUTH_REQUIRED` (:265-277). Schema names are built from slugs constrained to `^[a-z0-9_]{3,40}$` at provisioning (`tenant-provisioner-pg.js:188-192`).

### Portal separation
Portals never touch the employee chain; own middleware sets `req.db` via `resolvePublicTenantDb()` and **cross-checks the token's `tid` against the resolved tenant** to block cross-tenant token replay (`customer-auth.js:123-130`); per-principal revocation cursor honoured (:133-147); manufacturer variant additionally gates on partner `status`.

### ⚠️ Isolation caveat (Low)
`getDb().getClient()` issues a **session-level** `SET search_path` outside any transaction (`tenant-db-manager-pg.js:91-95`). Under transaction-mode pooling the SET and the caller's subsequent `BEGIN` (e.g. `routes/import.js:354-374`) are not guaranteed to land on the same backend. The failure mode is **fail-safe** (wrong search_path → default `public`, where tenant tables don't exist → error), *not* cross-tenant reads (SET LOCAL from other requests reverts at COMMIT) — but it is fragile.

---

## 3. Input handling

### Zod validation
`validate(schema)` appears at ~243 call sites across **62 of ~180 route files**. Substantial but not universal — `returns.js` has 1, `purchase-orders.js` 1, many report/read files none.

### SQL parameterization
`$1/$2` placeholders throughout. Every template-literal interpolation found by a repo-wide grep falls into:
- (a) **schema names from regex-validated slugs** — `tenant-db-manager-pg.js:63,79,93`; `routes/webhooks.js:241`; `migrate-pg.js:10074`
- (b) **in-code registries never touching user input** — `routes/webhooks.js:51-59,72,317-321` (deposit `ENTITY_ADAPTERS`); `services/phase4-polling.js` and `services/catalog-scheduler.js`, both allowlist-guarded per their headers
- (c) **dynamic `SET ${sets.join(", ")}` builders** with parameterised values — `bookings.js:110,287`; `classes.js:97` (field lists are code-side; spot-checked, not exhaustively audited)
- (d) **code-chosen WHERE fragments** like `${outletClause}` with `$n` params — `attendance.js:94-132`

**No user-input string concatenation into SQL was found.**

⚠️ One defence-in-depth gap: `jobs/cleanup-dead-tenants.js:51` interpolates a registry-sourced slug into `DROP SCHEMA` **without** the immediate re-validation that `routes/admin/tenants.js` performs before its own DROP.

### Uploads (`middleware/upload-validation.js`)
Shared MIME+extension allowlist factory. `rasterImageFileFilter` **excludes SVG specifically** because a same-origin-served SVG can carry script (documented **P31** incident, :25-36); clinical filter adds PDF/plain-text, still no SVG; `verifyImageMagicBytes` available for post-accept spoof detection (**P32**). Express JSON body cap 10 MB.

---

## 4. Transport, headers, CORS, rate limiting

- ⚠️ `helmet` with **CSP and COEP disabled** (`index.js:120-123`) — an API-only origin, but no header-level script-injection backstop for anything the API serves directly (`/uploads`, the `/r2/*` proxy, which deliberately sets `Cross-Origin-Resource-Policy: cross-origin`)
- CORS: allowlist from `CORS_ORIGIN` (CSV) with `credentials: true`; ⚠️ dev fallback `localhost:5173` (:124-129). `trust proxy = 2` in production so limiting keys on the real client IP
- Cookies: refresh tokens only (tenant `/api/auth`, admin `/api/admin/auth`), httpOnly + secure + SameSite None in prod. **Access tokens are not cookie-borne** (see §8)
- Rate limiters (`middleware/rate-limit.js`, all verified): global 600/min per tenant+IP **skipping POS burst paths** (:41-63); auth 20/15 min; webhook 120/min; portal auth 10 & 5/15 min; OTP 5/15 min per email+IP; portal data 120 & 60/min; public booking 10/15 min; public restaurant 60/min; member kiosk 30/min; PIN validate 20/15 min (with an explicit brute-force rationale, :231-246); admin TOTP 5/15 min. Most non-global limiters are skipped under `NODE_ENV === 'test'`. **All in-memory — single-instance only**

---

## 5. Secrets & crypto at rest

`services/crypto.js`: AES-256-GCM, 12-byte random IV, format `enc:v1:{iv}:{tag}:{ct}`; key from `INTEGRATION_SECRET_KEY`/`SHOPIFY_SECRET_KEY` accepted as 64-hex, base64-32, or ⚠️ **SHA-256 of an arbitrary passphrase** (:9-18 — no KDF stretching; acceptable for a high-entropy env var, weak for a human-chosen one).

⚠️ **Silent plaintext degradation:** with no key configured, `encryptSecret` **stores plaintext** (:26) and `decryptSecret` passes non-prefixed values through (:37).

- **Encrypted:** integration / marketplace / courier / Shopify credentials
- **Hashed:** passwords, PINs (bcrypt 10), refresh tokens (SHA-256), admin recovery codes (bcrypt)
- **Plaintext at rest:** admin TOTP secrets (`totp_secret` base32 — necessary to verify codes; noted in `migrate-pg.js:9528`), legacy `pin_code` values, and any integration credential written while the key was unset

---

## 6. Webhooks & public endpoints

| Endpoint | Verified? | Mechanism |
|---|---|---|
| `POST /api/webhooks/xpay` | ✅ | `paymentGateway.verifyWebhook` over `req.rawBody`; invalid → 400 (`webhooks.js:536-546`) |
| `POST /api/webhooks/meta`, `/whatsapp` | ✅ fail-closed | hex HMAC-SHA256 `x-hub-signature-256`, app-level `META_APP_SECRET`; unset secret **refuses** (`no_app_secret_configured`), constant-time compare (`services/meta-webhook.js:47-51, 82-119`); GET handshake refuses when verify token unset — closes the `undefined===undefined` bypass (:99-106) |
| `POST /api/webhooks/{foodpanda,careem}` | ✅ fail-closed | per-tenant secret, base64 HMAC + replay window; route-then-verify (`webhooks.js:844-896`) |
| `POST /api/webhooks/daraz` | ❌ **No** | trust-the-payload, rate-limited only; deliberate deferral documented in-code pending the inbound signing contract (`webhooks.js:757-777`). ⚠️ Blast radius: order upsert into whichever tenant has an active daraz integration, incl. a **single-integration fallback** (:151-157) |
| `POST /api/integrations/shopify/webhooks/*` | ✅ | base64 HMAC over raw body, length-guarded `timingSafeEqual`, fail-closed on missing secret (`shopify/utils.js:74-90`) |

**Notable:** Meta/WhatsApp have **no replay window** (no signed timestamp). Meta orders are idempotent via `ON CONFLICT` (`webhooks.js:648-654`), but ⚠️ **WhatsApp inbound messages have no idempotency on `external_id`** — a replayed valid delivery duplicates inbox rows (:724-748, no conflict clause).

**Public no-auth endpoints:** tenant resolved by `resolvePublicTenantDb` (active-tenant slug lookup, `services/public-tenant-context.js:8-31`).
- ⚠️ Kiosk PIN check-in (`POST /api/attendance/pin-checkin`, `attendance.js:374`) has Zod + bcrypt but **no dedicated rate limiter** — only the global 600/min applies (bcrypt cost is the practical brake)
- ⚠️ Public gift-card balance lookup (`gift-cards-public.js:18-71`) returns only balance/status/currency, but also has **no dedicated limiter** — code-guessing is throttled only globally; security rests on code entropy
- ⚠️ Signup and public inquiries are Turnstile-gated **only when `TURNSTILE_SECRET_KEY` is set** (`routes/auth.js:805-833`, `public-inquiries.js:22-33`) — an env-conditional control

---

## 7. Platform / RLS

`enableRlsOnPublicTables` (`migrate-pg.js:10004-10017`) enables RLS on every public-schema table with no policies; run by v98 and **unconditionally on every deploy** (:10118-10122), plus per-table declarations in newer migrations. Because the backend connects as `postgres` (**bypassrls**), this exclusively blocks Supabase PostgREST anon/authenticated roles from reading tenant registry/queue tables — **it is not an app-level isolation control** (in-code comment, :7129-7139).

---

## 8. Frontend

- **Token storage: localStorage** for all four scopes — tenant `"authSession"` (`auth/authStore.js:1-70`), admin `"adminSession"`, slug-scoped portal stores. Access tokens are therefore XSS-readable; refresh tokens are httpOnly-cookie-only, and reuse detection limits stolen-refresh value
- **XSS surface:** **zero `dangerouslySetInnerHTML`** occurrences in `frontend/src` (repo-wide grep). React default escaping applies
- **Turnstile:** site key via `VITE_TURNSTILE_SITE_KEY`; enforced server-side only when the secret is configured

---

## 9. Gaps / risks

| # | Sev | Finding | Citation |
|---|---|---|---|
| 1 | **Med** | Daraz webhook accepts unsigned payloads (documented deferral); single-active-integration fallback widens targeting | `webhooks.js:757-777, 151-157` |
| 2 | **Med** | `crypto.js` silently stores integration credentials in **plaintext** if the key env var is unset — no boot assertion covers `INTEGRATION_SECRET_KEY` | `services/crypto.js:26,37`; `boot/assert-secrets.js` covers only the two portal JWT secrets |
| 3 | **Med** | Legacy plaintext PIN fallback: pre-v14 rows stay plaintext at rest and compare with `===` (non-constant-time) on kiosk and manager-override paths | `routes/attendance.js:44-62`; `services/manager-pin.js:46` |
| 4 | Low-Med | Kiosk PIN check-in and public gift-card lookup have no dedicated limiter; global limiter fully **skips** `/api/sales`, `/api/orders` etc., so those paths' abuse control is auth, not throttling | `attendance.js:374`; `gift-cards-public.js:18`; `rate-limit.js:41-48,61` |
| 5 | Low-Med | Helmet CSP disabled; API also serves `/uploads` static — SVG still allowed on rasterized-image routes, so correctness depends on every consumer of that filter actually rasterizing | `index.js:120-123`; `upload-validation.js:11-23,62` |
| 6 | Low | Revocation checks silently skipped on any DB error (`catch {}` treats "table missing" and "query failed" identically) | `tenant-auth.js:167-169` |
| 7 | Low | No admin/employee account lockout (rate limiters only); admin tokens share `JWT_SECRET` (scope-string separation, not key separation) | `admin/auth.js:81,54-57`; `rate-limit.js:65-77` |
| 8 | Low | `getClient()` uses session-level `SET search_path` without a transaction — fragile under transaction pooling (fail-safe, not cross-tenant) | `tenant-db-manager-pg.js:91-95` vs :57-89 |
| 9 | Low | `cleanup-dead-tenants.js` interpolates a DB-stored slug into `DROP SCHEMA` without immediate re-validation | `jobs/cleanup-dead-tenants.js:51` |
| 10 | Low | Turnstile/CAPTCHA is env-conditional (silently absent if unset); Zod covers ~62/180 route files | `routes/auth.js:809` |
| 11 | Low | WhatsApp inbound messages have no `external_id` idempotency — a replayed valid delivery duplicates inbox rows | `webhooks.js:724-748` |
| 12 | Info | Access tokens in localStorage (all four scopes) — standard SPA trade-off, mitigated by 24 h/1 h TTLs, jti revocation, rotating httpOnly refresh cookies | `auth/authStore.js`, `adminAuthStore.js` |
| 13 | Info | All rate limiters and caches are in-process — correct at one instance, silently ineffective at 2+ | `rate-limit.js`; `tenant-auth.js:14-19` |

---

## 10. Strengths (verified)

Fail-closed production boot guard for portal secrets with entropy checks; scope gate before tenant-context attach; refresh rotation with **family-wide reuse revocation** on both tenant and admin planes; `SET LOCAL`-in-transaction search_path isolation with a **throwing, never-defaulting** tenant DB proxy; `?tenant=` allowlist; consistent bcrypt with hashed-at-rest refresh tokens; per-request permission loads with a **503-not-empty-perms** failure posture; outlet-context validation with no-existence-leak error codes and the base-vs-effective perms invariant; constant-time HMAC verification across Shopify/Meta/aggregator webhooks with fail-closed unset-secret handling; SVG-aware upload filters born from a documented prior XSS incident; TOTP-gated admin panel with hashed single-use recovery codes, session listing, and security-event logging; every-deploy RLS sweep on the public schema; **zero `dangerouslySetInnerHTML`** in the frontend.

---

## 11. Overall posture

A deliberately layered, mostly fail-closed posture with strong tenant-isolation and token-lifecycle mechanics. Residual risk concentrates in:

1. **Env-conditional controls that degrade silently when a variable is unset** — integration-credential encryption, Turnstile
2. **The deliberately unverified Daraz webhook**
3. **Legacy plaintext-PIN read paths**
