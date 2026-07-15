# Auth — Claude Guide

Four independent auth scopes, each with its own localStorage-backed store. Never mix them: tenant/dashboard (`AuthProvider.jsx` + `authStore.js`), super-admin (`adminAuthStore.js`), customer portal (`customerPortalStore.js`, slug-scoped), manufacturer portal (`manufacturerPortalStore.js`, slug-scoped). Each scope has its own JWT secret server-side — none of the four stores or tokens are interchangeable.

---

## `AuthProvider.jsx` — tenant/dashboard auth

Exports `AuthProvider` + `useAuth()`. This is the only scope that patches `window.fetch`.

### `useAuth()` return shape

| Field | Notes |
|-------|-------|
| `session` | Raw session object from localStorage |
| `employee` | `session.employee` |
| `permissions` | `string[]`, re-fetched fresh on boot — never trusted from localStorage. Outlet-context-dependent: boot loads the employee's *base* role permissions, and a later bootstrap overlay can swap in an outlet-specific effective set (see `applyEffectiveSession`) |
| `isAuthenticated` | `Boolean(employee?.id)` |
| `isBootstrapping` | `true` during initial boot async work — gate redirects on this |
| `login(username, password, tenantSlug?)` | See login flows below |
| `logout()` | Clears session, posts `AUTH_LOGOUT` to the service worker, best-effort `POST /api/auth/logout` |
| `refreshPermissions(roleId, employeeId?)` | `GET /api/roles/:roleId/permissions` |
| `refreshAccessToken()` | `POST /api/auth/refresh` via httpOnly cookie; a module-level `_refreshPromise` coalesces concurrent callers so simultaneous 401s only trigger one refresh |
| `applyEffectiveSession(emp)` | Overlays a `GET /api/context/bootstrap` `employee` payload (`permissions`, `base_role_id`, `effective_role_id`, `effective_role_name`) onto the stored session and persists it. No-ops unless the payload has an array `permissions` AND its `id` matches the currently stored employee — a stale or foreign response can't hijack the live identity. Called by `PresetContext` whenever it fetches the bootstrap (boot, outlet switch, permission changes); pages should not call this directly |
| `hasPerm(perm)` | `true` if `permissions` includes `"all_access"`, or if `perm` (string) is in `permissions`. Also accepts an array of perm strings and returns true if any match (backs UI gated by a backend `requireAnyPerm` check) |
| `authHeaders(extra?)` | Returns `{ "x-employee-id": ..., Authorization?: ... }` for callers that build headers manually instead of relying on the fetch patch (e.g. `useFeatureFlags`, which runs before the interceptor is wired) |
| `token` | JWT access token (multi-tenant mode only) |
| `isImpersonating` / `impersonationTenantName` / `impersonationSessionId` | Admin-impersonation state |
| `subscriptionStatus` | `null \| 'trial' \| 'grace' \| 'expired' \| 'active'` |
| `subscriptionDaysLeft` | number or null (trial or grace days remaining) |
| `tenantPlan` | `null \| 'free' \| 'pro'` |
| `company` | `session.company`, refreshed from `GET /api/auth/me` on boot; includes `tax_mode` |

### Fetch interceptor (`window.fetch` patch)

Installed in a `useEffect` keyed **only** on `employee?.id` — do not add `token` to that dependency array, it causes a re-registration loop. Token is always read live via `readToken()` inside the patched function, never captured in the closure. `window._nativeFetch` stashes the unpatched fetch (used internally by `refreshAccessToken` and by `ImpersonationBanner`'s exit flow to avoid recursing back into the patch).

The patch matches any URL containing `${API}/api/` or starting with `/api/`. It falls through to the native fetch untouched when: the URL isn't an API call, there's no authenticated employee, or the URL is one of the public auth endpoints (`/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password` — these must never receive employee credentials).

Per matched request:
1. **Offline guard** — a non-GET/HEAD/OPTIONS call while `!navigator.onLine` short-circuits to a synthetic `503` with header `X-Offline-Mode: 1` instead of touching the network.
2. **Header injection** — `x-employee-id` always; `Authorization: Bearer <token>` in multi-tenant mode via `readToken()`; `x-company-id`/`x-outlet-id`/`x-scope-mode` from `readContext()` when present. `credentials: "include"` is added in multi-tenant mode.
3. **Silent token refresh** — on a `401` whose body is `{ code: "TOKEN_EXPIRED" }` (multi-tenant only), calls `refreshAccessToken()` and retries the original request once with the new token. Confirmed in source: this is real, not aspirational — `refreshAccessToken` posts to `/api/auth/refresh` with `credentials: "include"`, and a successful response rewrites both `authStore` and React state before the retry fires.
4. **Failed-request tracking** — on any non-ok response, stashes the `X-Request-Id` response header into `window.__lastFailedReqId` (read by the support-ticket widget for context).
5. **Subscription expiry** — on a `403` with `{ code: "SUBSCRIPTION_EXPIRED" }`, sets `subscriptionStatus` to `"expired"` so the global banner reacts immediately.

### Boot sequence (mount-only `useEffect`)

1. URL has `?impersonate_token=&impersonate_session=`? Verify the token server-side via `GET /api/auth/me` with it as the Bearer token (never trust the token client-side) — build an impersonation session, write it, strip the URL params, done.
2. Existing stored session has `isImpersonation: true`? Restore as-is, done.
3. No existing session → done, `isBootstrapping = false`.
4. Existing session → re-fetch permissions via `refreshPermissions` (never trust localStorage perms). Best-effort `GET /api/auth/me` refreshes `company` (a failure here is non-fatal; boot continues with the cached company). Any thrown exception in this branch tears the whole session down (`clearSession()` + `setSession(null)`).
5. Multi-tenant only, after step 4 succeeds: `GET /api/billing/status` populates `subscriptionStatus`, `subscriptionDaysLeft`, `tenantPlan` (best-effort, swallows errors).

Boot deliberately only ever loads the **base** role's permissions — `AuthProvider` boots before any outlet context is known. `PresetContext`'s own bootstrap fetch (`GET /api/context/bootstrap`, keyed on `employee?.id`) supplies the outlet-effective permission set moments later via `applyEffectiveSession`.

Two consequences worth knowing. (1) Between boot and that overlay, `hasPerm()` reflects the base role — at an outlet whose override is *narrower*, nav can briefly show entries that outlet doesn't actually grant. (2) If the bootstrap request fails, the overlay never applies and perms stay base for the rest of the session. Neither is a privilege hole: `hasPerm()` only draws UI — the backend re-resolves the effective role on every request, so a route the outlet's role doesn't grant still 403s regardless of what the nav shows. Don't "fix" this by making boot itself outlet-aware — keeping the base-perms boot separate from the overlay is what keeps outlet reach (an identity decision) independent of the per-outlet role override.

### Login flows

- **Single-tenant**: `POST /api/auth/login` with `{ username, password }`. No `credentials`, no token — the resulting session is just `{ employee, permissions }`.
- **Multi-tenant**: `POST /api/auth/mt-login` with `{ tenant_slug, username, password }`, `credentials: "include"` (receives the httpOnly refresh cookie). Session additionally carries `token`, `tenant_slug`, `tenant`.

---

## `authStore.js` — tenant session storage

localStorage key `"authSession"`. A session must pass `isSessionStructValid` (`employee.id` + `employee.role_id` both present) or `readSession`/`writeSession` reject it.

- `readSession()` / `writeSession(session)` / `clearSession()` — `writeSession` also mirrors `session.employee` into the legacy key `"currentEmployee"` for older pages that still read it directly; `clearSession` also removes `"currentEmployee"` and `"sanopos_feature_flags_cache_v1"` so the next tenant logged into this browser doesn't see a stale flag set on first paint.
- `readContext()` / `writeContext(context)` / `clearContext()` — outlet/company/scope-mode context, merged into or stripped from the session object.
- `readToken()` / `writeToken(token)` — the JWT access token, merged into the session.
- `readTenantSlug()` — `session.tenant_slug ?? null`.

Known direct-localStorage exceptions that bypass this module intentionally: `CurrencyContext.jsx` reads `"authSession"` directly for `tenant_slug` (it renders before `AuthProvider` is available); `ImpersonationBanner.jsx` removes `"authSession"`/`"currentEmployee"` directly on impersonation exit.

---

## `adminAuthStore.js` — super-admin session storage

localStorage key `"adminSession"`. Much thinner than `authStore.js` — no struct validation, no context helpers, no token-refresh support.

- `readAdminSession()` and `getAdminSession()` are identical (both just call the same internal `_read()`).
- `writeAdminSession(session)` / `clearAdminSession()`.
- `getAdminToken()` → `session.token ?? null`.

Completely separate JWT from tenant auth — never read by `AuthProvider` or vice versa.

---

## `customerPortalStore.js` — customer self-service portal storage

localStorage key template: `` customerPortalSession:${slug} `` — slug-scoped, so one browser can hold sessions for multiple tenants' portals simultaneously.

- `readPortalSession(slug)` / `writePortalSession(slug, session)` / `clearPortalSession(slug)` — all no-op (or return `null`) without a slug.
- `getPortalToken(slug)` → `session.access_token ?? null`.
- `getPortalCustomer(slug)` → `session.customer ?? null`.

Backs `PortalAuthProvider` (`pages/portal/`) and `src/api/portalApi.js`. Its own JWT scope server-side — not interchangeable with the tenant or admin stores.

---

## `manufacturerPortalStore.js` — manufacturer/brand-partner portal storage

localStorage key template: `` manufacturerPortalSession:${slug} `` — identical slug-scoped shape to `customerPortalStore.js` (this is the wholesale secondary-sales manufacturer-partner portal, not a customer).

- `readMfgPortalSession(slug)` / `writeMfgPortalSession(slug, session)` / `clearMfgPortalSession(slug)`.
- `getMfgPortalToken(slug)` → `session.access_token ?? null`.
- `getMfgPortalPartner(slug)` → `session.partner ?? null`.

Own parallel JWT scope server-side. Backs the portal UI at `/manufacturer-portal/:slug`.

---

## Cross-cutting notes

- All four stores are fully independent: different localStorage keys, different JWT secrets server-side, never read each other's data.
- Only `AuthProvider.jsx` patches `window.fetch`. Admin pages use `adminFetch` (`pages/admin/AdminLogin.jsx`); portal pages use `portalApi` (`api/portalApi.js`) — both read their own store directly and are not covered by the tenant interceptor, so they must attach their own auth headers manually.
- The two portal stores share one pattern: slug-scoped key + CRUD (`read`/`write`/`clear`) + two convenience getters (`getXToken`, `getXEntity`). Copy this shape for any future portal type rather than inventing a new one.
- `authStore.js` is the only store with struct validation (`isSessionStructValid`) and dedicated context/token sub-helpers — `adminAuthStore.js` and the two portal stores are intentionally simpler CRUD wrappers with no validation.
