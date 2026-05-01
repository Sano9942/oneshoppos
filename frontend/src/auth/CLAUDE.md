# Auth — Claude Guide

**4 files** — authentication layer for tenant (app), admin, and customer portals.

---

## `AuthProvider.jsx`

Exports `AuthProvider` + `useAuth()`.

### `useAuth()` return shape

| Field | Type | Notes |
|-------|------|-------|
| `session` | `object\|null` | Full raw session object from localStorage |
| `employee` | `object\|null` | `session.employee` |
| `permissions` | `string[]` | `session.permissions` — fresh-fetched on boot |
| `isAuthenticated` | `boolean` | `Boolean(employee?.id)` |
| `isBootstrapping` | `boolean` | `true` while initial boot async work runs — use to gate redirects |
| `login(username, password, tenantSlug?)` | `async fn` | See login flows below |
| `logout()` | `async fn` | Clears session, posts AUTH_LOGOUT to SW, calls `/api/auth/logout` |
| `refreshPermissions(roleId, employeeId?)` | `async fn` | Fetches fresh perms — called internally on boot |
| `refreshAccessToken()` | `async fn` | Attempts token refresh via `/api/auth/refresh` |
| `hasPerm(perm)` | `fn → boolean` | `true` if `permissions` includes `"all_access"` OR the specific perm |
| `authHeaders(extra?)` | `fn → object` | Returns `{ "x-employee-id": ..., "Authorization": ... }` — used by components needing manual headers (e.g. `useFeatureFlags`) |
| `token` | `string\|null` | JWT access token (MT mode only) |
| `isImpersonating` | `boolean` | True during admin impersonation session |
| `impersonationTenantName` | `string\|null` | Tenant name shown in amber banner |
| `impersonationSessionId` | `string\|null` | Used for impersonation audit trail |
| `subscriptionStatus` | `null\|'trial'\|'grace'\|'expired'\|'active'` | Drives `SubscriptionBanner` |
| `subscriptionDaysLeft` | `number\|null` | Days remaining in trial or grace period |
| `tenantPlan` | `null\|'free'\|'pro'` | Tenant subscription plan — used by billing UI and plan-gated features |
| `company` | `object\|null` | `session.company` — loaded from `/api/auth/me` on boot; includes `tax_mode` (`'inclusive'\|'exclusive'\|'none'`), used by POS to default and hide the tax-inclusive toggle (P8/3.14) |

### Fetch interceptor (patches `window.fetch`)

Applied to all calls where URL contains `${API}/api/` or starts with `/api/`. Skipped for:
- Non-API URLs
- No authenticated employee
- Public auth endpoints: `/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password`

**Headers injected automatically:**

| Header | When |
|--------|------|
| `x-employee-id` | Always (when employee is authenticated) |
| `Authorization: Bearer <token>` | MT mode only, reads live via `readToken()` |
| `x-company-id` | When `context.active_company_id` is set in session |
| `x-outlet-id` | When `context.active_outlet_id` is set in session |
| `x-scope-mode` | When `context.scope_mode` is set in session |

**Interceptor behaviors (in order):**
1. **Offline guard** — non-GET while `!navigator.onLine` returns synthetic `503` with `X-Offline-Mode: 1`
2. **Header injection** — injects employee/token/context headers
3. **Token refresh** — on 401 with `body.code === "TOKEN_EXPIRED"` (MT only): calls `refreshAccessToken()`, retries once. `_refreshPromise` module-level lock prevents parallel refresh stampede
4. **Request ID tracking** — sets `window.__lastFailedReqId` to `X-Request-Id` on any failed response (used by `SupportWidget`)
5. **Subscription expiry** — on 403 with `body.code === "SUBSCRIPTION_EXPIRED"`: sets `subscriptionStatus = "expired"`

**Token reads live via `readToken()`** — the interceptor is only re-registered when `employee?.id` changes, NOT when `token` changes. Do NOT add `token` to any `useEffect` dep array that wraps the interceptor.

`window._nativeFetch` is set by the interceptor so the refresh function can bypass it (avoids infinite recursion).

### Boot sequence (on mount)

1. Check URL for `?impersonate_token=&impersonate_session=` — if present, verify token via `GET /api/auth/me`, store impersonation session, clean URL params
2. If existing session has `isImpersonation: true` — restore impersonation state
3. No session → set `isBootstrapping = false`, done
4. Existing session → **re-fetch permissions** fresh from `GET /api/roles/:roleId/permissions` (localStorage permissions not trusted)
5. Also calls `GET /api/auth/me` best-effort to refresh `session.company` — result merged back via `writeSession` before the refreshed session is used (outside the impersonation verification path)
6. In MT mode → fetch `GET /api/billing/status` to populate `subscriptionStatus` + `subscriptionDaysLeft`
7. If permission fetch fails → `clearSession()`, logout

### Login flows

**Single-tenant:** `POST /api/auth/login` with `{ username, password }` — no `credentials: "include"`, no token stored

**Multi-tenant:** `POST /api/auth/mt-login` with `{ tenant_slug, username, password }` + `credentials: "include"` (receives httpOnly refresh cookie). Session includes `token`, `tenant_slug`, `tenant` object.

### Logout

1. `POST /api/auth/logout` (best-effort — errors swallowed)
2. `navigator.serviceWorker.controller.postMessage({ type: "AUTH_LOGOUT" })` — clears SW cache
3. `clearSession()` + `setSession(null)`

---

## `authStore.js`

localStorage key: `"authSession"`. All reads/writes go through these helpers — never access `localStorage` directly for auth data. **Exceptions:** `CurrencyContext.jsx` reads `"authSession"` directly to extract `tenant_slug`; `ImpersonationBanner.jsx` reads `"adminSession"` and removes `"authSession"` and `"currentEmployee"` directly during exit.

**Exports:**

| Export | Purpose |
|--------|---------|
| `AUTH_KEY` | Constant `"authSession"` |
| `isSessionStructValid(session)` | Validates `session.employee.id` + `session.employee.role_id` exist |
| `readSession()` | Parses + validates; returns `null` on invalid/missing |
| `writeSession(session)` | Only writes if valid. Also writes `localStorage["currentEmployee"]` (backward compat) |
| `clearSession()` | Removes both `"authSession"` and `"currentEmployee"` |
| `readContext()` | Returns `session.context \| null` |
| `writeContext(context)` | Merges `context` into existing session |
| `clearContext()` | Removes `context` key from session (via destructuring) |
| `readToken()` | Returns `session.token \| null` |
| `writeToken(token)` | Merges `token` into existing session |
| `readTenantSlug()` | Returns `session.tenant_slug \| null` |

**`writeSession` backward compat:** also writes `localStorage["currentEmployee"]` for any pages still reading that key directly.

---

## `adminAuthStore.js`

localStorage key: `"adminSession"`. Mirror of `authStore.js` for the `/admin` portal — simpler, no context or token refresh helpers.

**Exports:**

| Export | Notes |
|--------|-------|
| `readAdminSession()` | Alias for `getAdminSession()` — both call `_read()` |
| `writeAdminSession(session)` | Stores full session object |
| `clearAdminSession()` | Removes `"adminSession"` |
| `getAdminToken()` | Returns `session.token \| null` |
| `getAdminSession()` | Returns full session object |

No `isSessionStructValid` — admin session has no required-field check.

---

## `customerPortalStore.js`

localStorage key: `customerPortalSession:${slug}` (slug-scoped — one browser can be logged into multiple tenant portals simultaneously).

**Exports:**

| Export | Purpose |
|--------|---------|
| `readPortalSession(slug)` | Returns full session object or null |
| `writePortalSession(slug, session)` | Stores session keyed by tenant slug |
| `clearPortalSession(slug)` | Removes session for this slug |
| `getPortalToken(slug)` | Returns `session.access_token \| null` |
| `getPortalCustomer(slug)` | Returns `session.customer \| null` |

Used by `PortalAuthProvider` in `pages/portal/` and by `frontend/src/api/portalApi.js` (which imports and uses `readPortalSession`, `writePortalSession`, and `clearPortalSession` directly). NOT interchangeable with `authStore.js` (tenant app) or `adminAuthStore.js` (super-admin).
