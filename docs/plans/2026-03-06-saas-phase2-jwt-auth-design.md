# SaaS Phase 2: JWT Authentication Overhaul — Design Document

**Date:** 2026-03-06
**Status:** Approved
**Depends on:** Phase 1 (complete — master.db, tenant-db-manager, provisioner)

---

## 1. Goal

Replace the insecure `x-employee-id` header-based auth with JWT tokens. Enable multi-tenant authentication where a single backend serves multiple isolated tenant databases, selected at login time via a "Store Code" (tenant slug).

**Non-goal:** This phase does NOT touch the DB proxy / AsyncLocalStorage layer (Phase 3) or frontend multi-tenant routing (Phase 4). It only adds JWT auth infrastructure + PIN hashing.

---

## 2. Auth Mode Toggle

```env
MULTI_TENANT=0   # default — single-tenant, current behavior preserved
MULTI_TENANT=1   # JWT auth, tenant routing via Store Code
```

When `MULTI_TENANT=0`: zero behavior changes. `x-employee-id` header, plaintext PIN compare, singleton `db` — everything works as today.

When `MULTI_TENANT=1`: JWT auth is active. Login requires `tenant_slug`. Middleware verifies JWT and resolves tenant DB.

---

## 3. Login Flow (Multi-Tenant Mode)

### 3.1 Standard Login

```
POST /api/auth/login
Body: { tenant_slug: "aces-hardware", username: "John", pin: "1234" }

1. Look up tenant by slug in master.db
   → SELECT id, slug, name, status, db_path FROM tenants WHERE slug = ? AND status = 'active'
   → If not found or suspended/deleted → 401 "Invalid store code"

2. Open tenant DB via TenantDbManager.getDb(tenantId)

3. Find employee by username in tenant DB
   → SELECT id, name, role_id, pin_hash FROM employees WHERE LOWER(name) = LOWER(?)

4. bcrypt.compare(pin, employee.pin_hash)
   → If mismatch → 401 "Invalid username or PIN"

5. Load permissions from tenant DB
   → SELECT permission FROM role_permissions WHERE role_id = ?

6. Sign JWT access token (24h)
   Payload: { tid: tenantId, eid: employeeId, rid: roleId, oid: null }
   (oid is null at login — set during context selection)

7. Sign refresh token (7d), store in tenant_refresh_tokens table in master.db
   Set as httpOnly cookie: refreshToken=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth

8. Return response:
   {
     token: "<access_jwt>",
     employee: { id, name, role_id },
     permissions: [...],
     tenant: { slug, name }
   }
```

### 3.2 Single-Tenant Login (MULTI_TENANT=0)

Unchanged from current. `POST /api/auth/login { username, pin }` — uses singleton `db`, compares `pin_hash` with bcrypt (PIN hashing migration applies to both modes).

### 3.3 Kiosk Login

```
POST /api/auth/kiosk-login
Body: { tenant_slug: "aces-hardware", pin: "1234" }

1. Look up tenant (same as standard login steps 1-2)
2. Find employee by PIN in tenant DB (scan all employees — kiosk is PIN-only)
   → SELECT id, name, role_id, pin_hash FROM employees
   → bcrypt.compare(pin, row.pin_hash) for each until match
3. Sign limited-scope JWT (8h, shorter than standard)
   Payload: { tid, eid, rid, oid: null, scope: "kiosk" }
4. No refresh token for kiosk sessions
5. Return: { token, employee: { id, name } }
```

**Kiosk scope enforcement:** Middleware checks `scope === "kiosk"` and restricts access to only attendance PIN endpoints (`/api/attendance/pin-*`).

---

## 4. JWT Structure

### 4.1 Access Token (24h expiry)

```json
{
  "tid": 7,
  "eid": 42,
  "rid": 1,
  "oid": 3,
  "scope": "full",
  "iat": 1709337600,
  "exp": 1709424000
}
```

- `tid` — tenant ID (for DB routing in Phase 3)
- `eid` — employee ID (replaces `x-employee-id` header)
- `rid` — role ID (for quick role checks without DB hit)
- `oid` — outlet ID (set after context selection, null initially)
- `scope` — `"full"` for standard login, `"kiosk"` for kiosk login

### 4.2 Refresh Token (7d expiry)

Opaque JWT stored in `tenant_refresh_tokens` table in master.db. Delivered via httpOnly cookie — never exposed to JavaScript.

### 4.3 Context Update

When the user selects a branch (outlet) after login, the frontend calls:

```
POST /api/auth/update-context
Body: { outlet_id: 3, scope_mode: "single_branch" }
Headers: Authorization: Bearer <current_token>

→ Verifies current JWT
→ Signs a new JWT with oid=3 and updated scope
→ Returns { token: "<new_jwt>" }
```

This replaces the `x-outlet-id` / `x-scope-mode` headers for authenticated context.

---

## 5. Middleware: loadTenantAndPerms

Replaces `loadEmployeePerms` when `MULTI_TENANT=1`.

```
For every /api/* request (except exempt paths):

1. Read Authorization header → extract Bearer token
2. jwt.verify(token, JWT_SECRET) → decode { tid, eid, rid, oid, scope }
3. If invalid/expired → 401 { error: "Token expired", code: "TOKEN_EXPIRED" }
4. Check tenant status in master.db:
   → SELECT status FROM tenants WHERE id = ?
   → If suspended → 403 { error: "Account suspended. Contact support." }
5. Set req.tenantId = tid, req.employee = { id: eid, role_id: rid }
6. Set req.context.outletId = oid, req.context.scopeMode from token
7. Load permissions from tenant DB (same query as current loadEmployeePerms)
   → db.get("SELECT role_id FROM employees WHERE id = ?", [eid])
   → db.all("SELECT permission FROM role_permissions WHERE role_id = ?", [rid])
   → req.employeePerms = rows.map(r => r.permission)
8. If scope === "kiosk", restrict to KIOSK_ALLOWED_PATHS only
9. next()
```

**Exempt paths (no JWT required):**
- `POST /api/auth/login`
- `POST /api/auth/kiosk-login`
- `POST /api/auth/refresh`
- `GET /api/feature-flags`
- Static file routes (`/uploads/*`)

**Note on DB access:** In Phase 2, the middleware uses the singleton `db` (same as today). The tenant DB routing via `req.tenantDb` becomes active in Phase 3 when the AsyncLocalStorage proxy is added.

---

## 6. Token Refresh

```
POST /api/auth/refresh
Cookie: refreshToken=<token>

1. Read refreshToken from httpOnly cookie
2. jwt.verify(refreshToken, JWT_REFRESH_SECRET)
3. Look up token in master.db tenant_refresh_tokens:
   → SELECT * FROM tenant_refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL
   → If not found or revoked → 401 "Refresh token invalid"
4. Check tenant status (same suspended check)
5. Sign new access token (24h) with same claims
6. Return { token: "<new_access_jwt>" }
```

### Refresh Token Table (in master.db)

```sql
CREATE TABLE IF NOT EXISTS tenant_refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  employee_id INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

Token is hashed (SHA-256) before storage — never stored as plaintext.

### Logout (Multi-Tenant)

```
POST /api/auth/logout
Headers: Authorization: Bearer <token>

1. Decode JWT (don't fail if expired — still revoke)
2. Revoke all refresh tokens for this employee:
   → UPDATE tenant_refresh_tokens SET revoked_at = datetime('now')
     WHERE tenant_id = ? AND employee_id = ? AND revoked_at IS NULL
3. Clear refreshToken cookie
4. Return { success: true }
```

---

## 7. PIN Hashing Migration (migrate66.js)

### 7.1 Employee PIN Migration

```sql
ALTER TABLE employees ADD COLUMN pin_hash TEXT;
```

Then in JS:
1. `SELECT id, pin_code FROM employees WHERE pin_code IS NOT NULL`
2. For each row: `pin_hash = await bcrypt.hash(pin_code, 10)`
3. `UPDATE employees SET pin_hash = ? WHERE id = ?`
4. After all rows updated: `-- pin_code column left in place but deprecated`

**Why not drop pin_code?** SQLite doesn't support `ALTER TABLE DROP COLUMN` in older versions. We leave it but stop reading it. All auth code reads `pin_hash` only.

### 7.2 Refresh Token Table

Add `tenant_refresh_tokens` table to master.db (schema in Section 6 above). This is created via `initMasterDb()` update, not via the tenant migration.

### 7.3 Employee Creation/Update

All `POST /api/employees` and `PUT /api/employees/:id` endpoints must hash the PIN before storing:
```javascript
const pin_hash = await bcrypt.hash(pin, 10);
// INSERT/UPDATE uses pin_hash column
```

---

## 8. Environment Variables

```env
# Required when MULTI_TENANT=1
JWT_SECRET=<random-64-chars>           # Signs access tokens
JWT_REFRESH_SECRET=<random-64-chars>   # Signs refresh tokens (separate secret)
MULTI_TENANT=0                         # 0 = single-tenant (default), 1 = multi-tenant

# Optional overrides
JWT_EXPIRES_IN=24h                     # Access token lifetime
JWT_REFRESH_EXPIRES_IN=7d              # Refresh token lifetime
```

For local dev, generate secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 9. Files Changed

| File | Action | Description |
|------|--------|-------------|
| `backend/package.json` | Modify | Add `jsonwebtoken`, `bcryptjs` |
| `backend/routes/auth.js` | Modify | Add tenant lookup, bcrypt compare, JWT sign/verify, refresh, kiosk-login, update-context |
| `backend/index.js` | Modify | Add `loadTenantAndPerms` middleware (alongside existing, toggled by `MULTI_TENANT`), add JWT exempt paths |
| `backend/migrate66.js` | Create | Add `pin_hash` column, hash existing PINs, update master.db schema |
| `backend/master-db.js` | Modify | Add `tenant_refresh_tokens` to MASTER_SCHEMA |
| `backend/routes/employees.js` | Modify | Hash PIN on create/update (both modes) |
| `backend/.env.example` | Create | Document all env vars |

**Frontend files are NOT modified in Phase 2.** Frontend changes (Bearer header, Store Code field, silent refresh) happen in Phase 4. Phase 2 is backend-only + migration.

---

## 10. Backward Compatibility

| Aspect | MULTI_TENANT=0 | MULTI_TENANT=1 |
|--------|----------------|----------------|
| Login body | `{ username, pin }` | `{ tenant_slug, username, pin }` |
| Auth header | `x-employee-id: 42` | `Authorization: Bearer <jwt>` |
| PIN storage | `pin_hash` (bcrypt) | `pin_hash` (bcrypt) |
| DB routing | singleton `db` | singleton `db` (Phase 3 adds proxy) |
| Permissions | loaded per-request | loaded per-request |
| Session | localStorage | localStorage + JWT + httpOnly cookie |

**PIN hashing applies to both modes.** This is the one breaking change — all PINs become bcrypt hashes. The migration handles existing data.

---

## 11. Testing Strategy

### Unit/Integration Tests (backend/tests/integration/)

1. **auth-jwt.test.js** — new test file:
   - Login with valid tenant_slug + username + pin → returns JWT + sets cookie
   - Login with invalid slug → 401
   - Login with suspended tenant → 401
   - Login with wrong PIN → 401
   - Refresh token → new access token
   - Refresh with revoked token → 401
   - Logout → revokes refresh tokens
   - Kiosk login → limited-scope JWT
   - Kiosk token rejected on non-attendance endpoints
   - Update-context → new JWT with oid set
   - Expired token → 401 with TOKEN_EXPIRED code

2. **Existing test suite** — must still pass with `MULTI_TENANT=0` (default). No test regressions.

3. **PIN migration test** — verify plaintext PINs are hashed correctly, login still works after migration.

---

## 12. Security Considerations

- **PIN hashing:** bcrypt with cost factor 10 (default). Acceptable for 4-10 digit PINs.
- **Refresh token storage:** SHA-256 hashed in DB. Even if DB is leaked, tokens can't be forged.
- **httpOnly cookie:** Refresh token not accessible to JavaScript — XSS can't steal it.
- **Tenant isolation:** JWT contains `tid` — middleware verifies tenant status on every request. A valid JWT for a suspended tenant is rejected.
- **Kiosk scope:** Prevents PIN-only kiosk auth from accessing admin endpoints.
- **Rate limiting:** Existing `authLimiter` (20/15min) stays in place for all login endpoints.

---

## 13. What This Does NOT Cover (Deferred)

- **Phase 3:** AsyncLocalStorage DB proxy — `req.tenantDb` routing per-request
- **Phase 4:** Frontend changes — Store Code field, Bearer header, silent refresh
- **Phase 5:** Super-admin dashboard
- **Subdomain routing:** Not planned — login-based tenant ID is sufficient
- **OAuth/SSO:** Not planned for initial SaaS launch
