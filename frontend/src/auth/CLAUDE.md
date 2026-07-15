# Auth — Claude Guide

Four independent auth scopes, four independent localStorage-backed stores. Never mix them: tenant/dashboard (`AuthProvider.jsx` + `authStore.js`), super-admin (`adminAuthStore.js`), customer portal (`customerPortalStore.js`, slug-scoped), manufacturer portal (`manufacturerPortalStore.js`, slug-scoped).

---

## `AuthProvider.jsx` — tenant/dashboard auth

Exports `AuthProvider` + `useAuth()`. Only scope that patches `window.fetch`.

### `useAuth()` return shape

| Field | Notes |
|-------|-------|
| `session` | Raw session object from localStorage |
| `employee` | `session.employee` |
| `permissions` | `string[]`, re-fetched fresh on boot — not trusted from localStorage. **Outlet-context-dependent** since Step 14 (D2b): boot loads the *base* role's set, then the bootstrap overlay swaps in the outlet-effective set (see `applyEffectiveSession`) |
| `isAuthenticated` | `Boolean(employee?.id)` |
| `isBootstrapping` | `true` during initial boot async work — gate redirects on this |
| `login(username, password, tenantSlug?)` | See login flows |
| `logout()` | Clears session, posts `AUTH_LOGOUT` to service worker, best-effort `POST /api/auth/logout` |
| `refreshPermissions(roleId, employeeId?)` | `GET /api/roles/:roleId/permissions` |
| `refreshAccessToken()` | `POST /api/auth/refresh` via httpOnly cookie; module-level `_refreshPromise` coalesces concurrent calls |
| `hasPerm(perm)` | `true` if `permissions` includes `"all_access"` or `perm` |
| `applyEffectiveSession(emp)` | Step 14 (D2b). Overlays a `GET /api/context/bootstrap` `employee` payload (`permissions`, `base_role_id`, `effective_role_id`, `effective_role_name`) onto the stored session. No-ops unless the payload has an array `permissions` AND its `id` matches the stored employee — so a stale/foreign response can't swap the live identity. Called by `PresetContext` on every bootstrap (boot, outlet switch, C8 role save); pages should not call it directly |
| `authHeaders(extra?)` | Returns `{ "x-employee-id", Authorization? }` for manual-header callers (e.g. `useFeatureFlags`) |
| `token` | JWT access token (MT mode only) |
| `isImpersonating` / `impersonationTenantName` / `impersonationSessionId` | Admin-impersonation state |
| `subscriptionStatus` | `null\|'trial'\|'grace'\|'expired'\|'active'` |
| `subscriptionDaysLeft` | number or null |
| `tenantPlan` | `null\|'free'\|'pro'` |
| `company` | `session.company` from `/api/auth/me`, includes `tax_mode` |

### Fetch interceptor (`window.fetch` patch)

Installed in a `useEffect` keyed **only** on `employee?.id` — do not add `token` to that dep array, it causes a re-registration loop; token is always read live via `readToken()`. `window._nativeFetch` stashes the unpatched fetch for internal use (`refreshAccessToken`, `ImpersonationBanner` exit flow) to avoid recursion.

Matches any URL containing `${API}/api/` or starting with `/api/`. Skipped (falls through to native fetch) when: not an API call, no authenticated employee, or URL matches `/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password`.

Order of operations per request:
1. **Offline guard** — non-GET/HEAD/OPTIONS while `!navigator.onLine` returns a synthetic `503` with `X-Offline-Mode: 1` instead of touching the network.
2. **Header injection** — `x-employee-id` always; `Authorization: Bearer <token>` (MT only, `readToken()`); `x-company-id`/`x-outlet-id`/`x-scope-mode` from `readContext()` when set. `credentials: "include"` added in MT mode.
3. **Silent token refresh** — on `401` with body `{ code: "TOKEN_EXPIRED" }` (MT only): calls `refreshAccessToken()`, retries the original request once with the new token.
4. **Failed-request tracking** — on any non-ok response, stashes `X-Request-Id` header into `window.__lastFailedReqId` (consumed by `SupportWidget`).
5. **Subscription expiry** — on `403` with `{ code: "SUBSCRIPTION_EXPIRED" }`, sets `subscriptionStatus = "expired"`.

### Boot sequence (mount-only `useEffect`)

1. URL has `?impersonate_token=&impersonate_session=`? Verify server-side via `GET /api/auth/me` with the token as Bearer (never trust the token client-side) — build an impersonation session, write it, strip the URL params, return.
2. Existing stored session has `isImpersonation: true`? Restore as-is, stop.
3. No existing session → done, `isBootstrapping = false`.
4. Existing session → re-fetch permissions via `refreshPermissions` (never trust localStorage perms). Best-effort `GET /api/auth/me` refreshes `company` (non-fatal on failure — boot continues with cached company). Any exception here tears the session down (`clearSession()` + `setSession(null)`).
5. MT mode only, after refresh succeeds: `GET /api/billing/status` populates `subscriptionStatus`, `subscriptionDaysLeft`, `tenantPlan` (best-effort).

Step 14 (D2b) deliberately did **not** change this sequence: step 4 still loads the **base** role's permissions, because `AuthProvider` boots before any outlet context is known. `PresetContext`'s own bootstrap (`GET /api/context/bootstrap`, keyed on `employee?.id`) supplies the outlet-effective set moments later via `applyEffectiveSession`.

Two consequences worth knowing. (1) Between boot and that overlay, `hasPerm()` reflects the base role — at an outlet whose override is *narrower*, nav can briefly show entries the outlet doesn't grant. (2) If the bootstrap request fails, the overlay never applies and perms stay base for the whole session (`presetLoaded` flips to `true` on error too, so it is **not** a reliable "effective perms are loaded" signal). Neither is a privilege hole: `hasPerm()` only draws UI, and the backend re-resolves the effective role on every request, so a route the outlet's role doesn't grant 403s regardless of what the nav shows. Don't "fix" this by making boot outlet-aware — the base-perms boot is what keeps outlet reach (an identity decision) independent of the override.

### Login flows

- **Single-tenant**: `POST /api/auth/login` `{ username, password }`. No `credentials`, no token — session is just `{ employee, permissions }`.
- **Multi-tenant**: `POST /api/auth/mt-login` `{ tenant_slug, username, password }`, `credentials: "include"` (receives httpOnly refresh cookie). Session additionally carries `token`, `tenant_slug`, `tenant`.

---

## `authStore.js` — tenant session storage

localStorage key `"authSession"`. Session must pass `isSessionStructValid` (`employee.id` + `employee.role_id`) or reads/writes are rejected.

- `readSession()` / `writeSession(session)` / `clearSession()` — `writeSession` also mirrors `session.employee` into legacy key `"currentEmployee"`; `clearSession` also removes `"currentEmployee"` and `"sanopos_feature_flags_cache_v1"` (so the next tenant on this browser doesn't see stale flags on first paint).
- `readContext()` / `writeContext(context)` / `clearContext()` — outlet/company/scope-mode context, merged into or stripped from the session.
- `readToken()` / `writeToken(token)` — JWT access token, merged into the session.
- `readTenantSlug()` — `session.tenant_slug ?? null`.

Known direct-localStorage exceptions (bypass this module intentionally): `CurrencyContext.jsx` reads `"authSession"` directly for `tenant_slug` (runs outside `AuthProvider`); `ImpersonationBanner.jsx` removes `"authSession"`/`"currentEmployee"` directly on impersonation exit.

---

## `adminAuthStore.js` — super-admin session storage

localStorage key `"adminSession"`. No struct validation, no context, no token-refresh helpers — much thinner than `authStore.js`.

- `readAdminSession()` and `getAdminSession()` are identical (both call the same internal `_read()`).
- `writeAdminSession(session)` / `clearAdminSession()`.
- `getAdminToken()` → `session.token ?? null`.

Completely separate JWT from tenant auth — never read by `AuthProvider`.

---

## `customerPortalStore.js` — customer self-service portal storage

localStorage key template: `` customerPortalSession:${slug} `` — slug-scoped, so one browser can hold sessions for multiple tenants' portals at once.

- `readPortalSession(slug)` / `writePortalSession(slug, session)` / `clearPortalSession(slug)` — all no-op/`null` without a slug.
- `getPortalToken(slug)` → `session.access_token ?? null`.
- `getPortalCustomer(slug)` → `session.customer ?? null`.

Backs `PortalAuthProvider` (`pages/portal/`) and `src/api/portalApi.js`. Own JWT scope server-side (`CUSTOMER_PORTAL_JWT_SECRET`) — not interchangeable with the tenant or admin stores.

---

## `manufacturerPortalStore.js` — manufacturer/brand-partner portal storage

localStorage key template: `` manufacturerPortalSession:${slug} `` — identical slug-scoped shape to `customerPortalStore.js` (wholesale secondary-sales, Tier 1.4).

- `readMfgPortalSession(slug)` / `writeMfgPortalSession(slug, session)` / `clearMfgPortalSession(slug)`.
- `getMfgPortalToken(slug)` → `session.access_token ?? null`.
- `getMfgPortalPartner(slug)` → `session.partner ?? null`.

Own parallel JWT scope (`MANUFACTURER_PORTAL_JWT_SECRET` server-side). Backs the portal at `/manufacturer-portal/:slug`.

---

## Cross-cutting notes

- All four stores are independent: different localStorage keys, different JWT secrets server-side, never read each other's data.
- Only `AuthProvider.jsx` patches `window.fetch`. Admin pages use `adminFetch` (`pages/admin/AdminLogin.jsx`); portal pages use `portalApi` (`api/portalApi.js`) — both read their own store directly and are not covered by the tenant interceptor.
- The two portal stores (`customerPortalStore.js`, `manufacturerPortalStore.js`) share one pattern: slug-scoped key + CRUD + two convenience getters (`getXToken`, `getXEntity`). Copy this shape for any future portal type rather than inventing a new one.
- `authStore.js` is the only store with struct validation (`isSessionStructValid`) and dedicated context/token sub-helpers — `adminAuthStore.js` and the portal stores are intentionally simpler CRUD wrappers.
