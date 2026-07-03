# Auth — Claude Guide

Authentication layer for tenant (app), super-admin, customer portal, and manufacturer portal. Four separate JWT scopes, four separate storage schemes — never mix them.

---

## `AuthProvider.jsx`

Exports `AuthProvider` + `useAuth()`. This is the tenant-app auth context — do not use it for admin or portal pages.

### `useAuth()` return shape

| Field | Type | Notes |
|-------|------|-------|
| `session` | `object\|null` | Full raw session object from localStorage |
| `employee` | `object\|null` | `session.employee` |
| `permissions` | `string[]` | `session.permissions` — fresh-fetched on boot, not trusted from localStorage |
| `isAuthenticated` | `boolean` | `Boolean(employee?.id)` |
| `isBootstrapping` | `boolean` | `true` while initial boot async work runs — gate redirects on this |
| `login(username, password, tenantSlug?)` | `async fn` | See login flows below |
| `logout()` | `async fn` | Clears session, posts `AUTH_LOGOUT` to service worker, calls `/api/auth/logout` |
| `refreshPermissions(roleId, employeeId?)` | `async fn` | Fetches fresh perms from `/api/roles/:roleId/permissions` — called internally on boot |
| `refreshAccessToken()` | `async fn` | Refreshes JWT via `/api/auth/refresh` (httpOnly cookie) |
| `hasPerm(perm)` | `fn → boolean` | `true` if `permissions` includes `"all_access"` OR the specific perm |
| `authHeaders(extra?)` | `fn → object` | Returns `{ "x-employee-id", "Authorization" }` for callers needing manual headers (e.g. `useFeatureFlags`) |
| `token` | `string\|null` | JWT access token (MT mode only) |
| `isImpersonating` | `boolean` | True during admin impersonation session |
| `impersonationTenantName` | `string\|null` | Shown in amber banner |
| `impersonationSessionId` | `string\|null` | Used for impersonation audit trail |
| `subscriptionStatus` | `null\|'trial'\|'grace'\|'expired'\|'active'` | Drives `SubscriptionBanner` |
| `subscriptionDaysLeft` | `number\|null` | Days remaining in trial or grace |
| `tenantPlan` | `null\|'free'\|'pro'` | Drives billing UI + plan-gated features |
| `company` | `object\|null` | `session.company`, loaded from `/api/auth/me` on boot; includes `tax_mode` (`'inclusive'\|'exclusive'\|'none'`) used by POS |

### Fetch interceptor (patches `window.fetch` globally)

Installed in a `useEffect` keyed only on `employee?.id`. Applies to any call whose URL contains `${API}/api/` or starts with `/api/`. Every call made through `api.js` — or raw `fetch()` to an `/api/` path anywhere in the app — passes through this. Skipped when:
- URL isn't an API call
- No authenticated employee
- URL matches a public auth endpoint: `/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password`

**Headers injected automatically:**

| Header | When |
|--------|------|
| `x-employee-id` | Always, when employee is authenticated |
| `Authorization: Bearer <token>` | MT mode only, token read live via `readToken()` |
| `x-company-id` | When `context.active_company_id` set in session |
| `x-outlet-id` | When `context.active_outlet_id` set in session |
| `x-scope-mode` | When `context.scope_mode` set in session |

**Interceptor behavior, in order:**
1. **Offline guard** — non-GET/HEAD/OPTIONS while `!navigator.onLine` returns a synthetic `503` with `X-Offline-Mode: 1` header instead of hitting the network
2. **Header injection** — as above
3. **Silent token refresh** — on `401` with response body `{ code: "TOKEN_EXPIRED" }` (MT only): calls `refreshAccessToken()`, retries the original request once with the new token. Module-level `_refreshPromise` lock coalesces concurrent refreshes into one call
4. **Failed-request tracking** — sets `window.__lastFailedReqId` from the `X-Request-Id` response header on any non-ok response (consumed by `SupportWidget`)
5. **Subscription expiry detection** — on `403` with `{ code: "SUBSCRIPTION_EXPIRED" }`: sets `subscriptionStatus = "expired"`

`window._nativeFetch` is stashed by the interceptor so `refreshAccessToken()` and other internal calls can bypass it and avoid infinite recursion. Anything that must skip the interceptor (e.g. `ImpersonationBanner`'s exit flow) also reaches for `window._nativeFetch`.

**Gotcha:** the interceptor is only re-registered when `employee?.id` changes, never when `token` changes — token is always read live via `readToken()`. Do NOT add `token` to the wrapping `useEffect`'s dependency array; it causes a re-registration loop.

### Boot sequence (runs once on mount)

1. Check URL for `?impersonate_token=&impersonate_session=`. If present: verify the token server-side via `GET /api/auth/me` (never trust the token client-side), build an impersonation session, write it, strip the params from the URL.
2. If an existing stored session has `isImpersonation: true`, restore it as-is and stop.
3. No existing session → `isBootstrapping = false`, done.
4. Existing session → re-fetch permissions fresh from `GET /api/roles/:roleId/permissions` (never trust localStorage permissions).
5. Best-effort `GET /api/auth/me` refreshes `session.company` (e.g. `tax_mode`) — merged into the session before it's committed. A failure here is non-fatal; boot continues with whatever `company` was already cached.
6. MT mode only: fetch `GET /api/billing/status` to populate `subscriptionStatus`, `subscriptionDaysLeft`, `tenantPlan`.
7. If the permissions re-fetch throws, the session is torn down (`clearSession()`, `setSession(null)`) — a stale/invalid session cannot silently persist.

### Login flows

- **Single-tenant:** `POST /api/auth/login` with `{ username, password }`. No `credentials: "include"`, no token stored — session is just `{ employee, permissions }`.
- **Multi-tenant:** `POST /api/auth/mt-login` with `{ tenant_slug, username, password }` and `credentials: "include"` (receives httpOnly refresh cookie). Session additionally carries `token`, `tenant_slug`, `tenant`.

### Logout

1. `POST /api/auth/logout` (best-effort, errors swallowed — a failed logout call must never block client-side teardown)
2. `navigator.serviceWorker.controller.postMessage({ type: "AUTH_LOGOUT" })` to clear SW cache
3. `clearSession()` + `setSession(null)`

---

## `authStore.js` — tenant session storage

localStorage key: `"authSession"`. All reads/writes must go through these helpers — never touch `localStorage` directly for tenant auth data. Known exceptions: `CurrencyContext.jsx` reads `"authSession"` directly to pull `tenant_slug` (runs outside `AuthProvider`), and `ImpersonationBanner.jsx` removes `"authSession"`/`"currentEmployee"` directly on impersonation exit.

| Export | Purpose |
|--------|---------|
| `AUTH_KEY` | Constant `"authSession"` |
| `isSessionStructValid(session)` | Requires `session.employee.id` and `session.employee.role_id` |
| `readSession()` | Parses + validates; `null` on missing/invalid/corrupt JSON |
| `writeSession(session)` | No-op if invalid. Also writes `localStorage["currentEmployee"]` for legacy readers |
| `clearSession()` | Removes `"authSession"`, `"currentEmployee"`, and `"sanopos_feature_flags_cache_v1"` (so the next tenant logged into this browser doesn't see stale flags on first paint) |
| `readContext()` / `writeContext(context)` / `clearContext()` | Outlet/company/scope context, merged into or stripped from the session |
| `readToken()` / `writeToken(token)` | JWT access token, merged into the session |
| `readTenantSlug()` | Returns `session.tenant_slug \| null` |

---

## `adminAuthStore.js` — super-admin session storage

localStorage key: `"adminSession"`. Structurally mirrors `authStore.js` but simpler — no context, no token-refresh helpers, no struct validation.

| Export | Notes |
|--------|-------|
| `readAdminSession()` / `getAdminSession()` | Both just call the same internal `_read()` — interchangeable |
| `writeAdminSession(session)` | Stores the full session object |
| `clearAdminSession()` | Removes `"adminSession"` |
| `getAdminToken()` | Returns `session.token \| null` |

Completely separate from tenant auth — an admin JWT and a tenant JWT are never the same token, and this store is never read by `AuthProvider`.

---

## `customerPortalStore.js` — customer self-service portal storage

localStorage key: `` customerPortalSession:${slug} `` — slug-scoped so one browser can hold sessions for multiple tenants' portals simultaneously.

| Export | Purpose |
|--------|---------|
| `readPortalSession(slug)` / `writePortalSession(slug, session)` / `clearPortalSession(slug)` | Basic CRUD, all require a slug (no-op / return null otherwise) |
| `getPortalToken(slug)` | Returns `session.access_token \| null` |
| `getPortalCustomer(slug)` | Returns `session.customer \| null` |

Consumed by `PortalAuthProvider` (`pages/portal/`) and `frontend/src/api/portalApi.js`. Uses its own JWT (`CUSTOMER_PORTAL_JWT_SECRET` server-side) — not interchangeable with `authStore.js` or `adminAuthStore.js`.

---

## `manufacturerPortalStore.js` — manufacturer/brand partner portal storage

localStorage key: `` manufacturerPortalSession:${slug} `` — same slug-scoped pattern as `customerPortalStore.js`, built for the Tier 1.4 manufacturer-partner portal.

| Export | Purpose |
|--------|---------|
| `readMfgPortalSession(slug)` / `writeMfgPortalSession(slug, session)` / `clearMfgPortalSession(slug)` | Basic CRUD, slug required |
| `getMfgPortalToken(slug)` | Returns `session.access_token \| null` |
| `getMfgPortalPartner(slug)` | Returns `session.partner \| null` |

Its own parallel JWT scope, separate from tenant, admin, and customer-portal auth. Backs the manufacturer portal at `/manufacturer-portal/:slug`.

---

## Cross-cutting notes

- **Four independent auth scopes, four independent storages**: tenant (`authStore.js`), super-admin (`adminAuthStore.js`), customer portal (`customerPortalStore.js`), manufacturer portal (`manufacturerPortalStore.js`). None of their tokens or localStorage keys overlap — do not read one store's key from another context.
- Only the tenant scope (`AuthProvider.jsx`) patches `window.fetch`. Admin and portal pages call their own fetch wrappers (`adminFetch`, `portalApi`) that read from their respective stores directly — they are not covered by the interceptor above.
- All portal-style stores (`customerPortalStore.js`, `manufacturerPortalStore.js`) follow the same slug-scoped key + CRUD-plus-two-getters shape. If adding a new portal type, copy that pattern rather than inventing a new one.
