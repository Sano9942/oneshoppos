# Frontend Architecture Audit (Codex)

Date: 2026-04-02

Scope: frontend only. This is a fresh audit of the current React/Vite app and does not rely on the project's own tests. I reviewed the app as if taking over a new codebase: routing, auth/session handling, context flow, offline/PWA behavior, admin shell, shared utilities, and representative page modules.

## Executive Summary

The frontend is more capable than its surface complexity suggests.

What is strong:
- route-level code splitting is used well
- the app has a coherent authenticated shell with permission guards
- context selection and tenant-aware session flow are clearly modeled
- offline POS support is a real product capability, not just marketing language
- there is a visible attempt to standardize newer UI work around redesigned route wrappers and shared primitives

What needs attention:
- the service worker caches authenticated API responses without clear user/tenant scoping
- browser storage is carrying too much security-sensitive session state
- some legacy pages bypass the shared auth layer and build their own headers
- the codebase still has parallel old/new frontend paths, which increases drift and maintenance cost
- feature-flag defaults are optimistic enough to hide backend truth when the flags API fails

Overall verdict: this is a good product frontend with real operational depth, but it is still in a transition phase. The biggest risks are not visual or stylistic; they are around cache/session consistency, legacy route drift, and cross-session data handling on shared devices.

## What The Frontend Gets Right

1. The route shell is thoughtfully split.
   Evidence: `frontend/src/App.jsx`
   Notes:
   - most major screens are lazy-loaded
   - protected app routes are separated from public, setup, receipt, and admin routes
   - the main app shell wraps auth, context, layout, and error boundaries in a readable order

2. The authenticated app model is understandable.
   Evidence: `frontend/src/auth/AuthProvider.jsx`, `frontend/src/components/RequireAuth.jsx`, `frontend/src/components/RequireContext.jsx`, `frontend/src/components/RequirePerm.jsx`

3. Offline POS is real and integrated into product behavior.
   Evidence: `frontend/src/pages/redesign/pos/POSContext.jsx`, `frontend/src/utils/offlineQueue.js`

4. The redesign layer is not just cosmetic; it is functioning as a migration path.
   Evidence: many `*Route.jsx` files map legacy route names to redesigned page modules.

5. Error handling is better than average for an internal-business app.
   Evidence: `frontend/src/ui/ErrorBoundary.jsx`, Sentry initialization in `frontend/src/main.jsx`

## Findings

### High

#### 1. The service worker caches authenticated API responses without clear session scoping

Evidence:
- `frontend/public/sw.js:2`
- `frontend/public/sw.js:5`
- `frontend/public/sw.js:7`
- `frontend/public/sw.js:8`
- `frontend/public/sw.js:12`
- `frontend/public/sw.js:13`
- `frontend/public/sw.js:14`
- `frontend/public/sw.js:40`
- `frontend/public/sw.js:41`
- `frontend/public/sw.js:54`
- `frontend/public/sw.js:106`
- `frontend/public/sw.js:107`

Problem:
The service worker caches same-origin API responses for paths like:
- `/api/feature-flags`
- `/api/outlets`
- `/api/products`
- `/api/reports/dashboard`
- `/api/notifications/count`

That cache is URL-based and not visibly partitioned by tenant, outlet context, or authenticated user. On shared devices, kiosk-like setups, or fast account switching, this creates a real risk of stale or cross-session data being shown to the wrong user.

The cache is only explicitly cleared when the app posts `AUTH_LOGOUT`, which covers normal employee logout flow, but not every possible session transition.

Impact:
- stale business data after account changes
- possible cross-tenant or cross-user leakage on shared devices
- hard-to-debug “ghost state” where UI disagrees with live backend data

Recommendation:
- do not cache authenticated API responses in the service worker unless the cache key is partitioned by tenant/user/session
- at minimum, remove protected API routes from SW caching
- if offline support is needed, cache only explicitly safe, user-scoped artifacts

### Medium

#### 2. Session storage relies heavily on `localStorage`, including admin auth

Evidence:
- `frontend/src/auth/authStore.js:14`
- `frontend/src/auth/authStore.js:25`
- `frontend/src/auth/authStore.js:27`
- `frontend/src/pages/admin/AdminLogin.jsx:8`
- `frontend/src/pages/admin/AdminLogin.jsx:15`
- `frontend/src/pages/admin/AdminLogin.jsx:19`
- `frontend/src/pages/admin/AdminLogin.jsx:34`

Problem:
Both employee and super-admin sessions are persisted in `localStorage`. That is operationally convenient, but it means session-bearing browser storage is a key part of the trust model.

This is not unusual in SPA codebases, but it raises the cost of any XSS issue, browser extension compromise, or shared-device misuse. It also creates two parallel client auth models:
- employee session in `authSession`
- admin session in `adminSession`

Impact:
- broader blast radius for any client-side script injection
- harder security reasoning because admin and employee auth are implemented differently
- increased chance of stale session artifacts during impersonation and logout flows

Recommendation:
- reduce what is stored in `localStorage`
- keep the browser copy of auth state as minimal as possible
- align employee/admin auth storage patterns where practical

#### 3. `PrinterSettingsRedesign` bypasses the shared auth abstraction and hardcodes an employee fallback of `"1"`

Evidence:
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:49`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:50`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:67`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:68`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:108`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:112`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:135`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:139`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:161`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:165`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:186`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:190`

Problem:
This page does not use `useAuth()` or the shared `authHeaders()` helper. Instead it manually sends:

`"x-employee-id": localStorage.getItem("employeeId") || "1"`

I did not find a matching frontend writer for `employeeId`, so the practical fallback is often `"1"`. That is a serious sign of legacy drift, and in single-tenant/header-auth mode it could misidentify the acting user.

Impact:
- incorrect actor identity on printer/email settings requests
- higher chance of permission drift versus the rest of the app
- brittle behavior that depends on hidden local browser state

Recommendation:
- remove all manual employee-id header construction from this page
- route every authenticated fetch through the shared auth/session layer
- audit other redesign pages for similar bypasses

#### 4. Feature-flag defaults are optimistic enough to mask backend reality

Evidence:
- `frontend/src/hooks/useFeatureFlags.js:4`
- `frontend/src/hooks/useFeatureFlags.js:5`
- `frontend/src/hooks/useFeatureFlags.js:13`
- `frontend/src/hooks/useFeatureFlags.js:26`
- `frontend/src/hooks/useFeatureFlags.js:42`
- `frontend/src/hooks/useFeatureFlags.js:50`

Problem:
`useFeatureFlags()` defaults many flags to enabled, including major product areas such as:
- `backup_restore`
- `multi_company`
- `approvals`
- `notifications`

If the feature-flags API fails, the UI falls back to these defaults instead of failing closed. That improves resilience, but it also means users can see screens and affordances that the backend may no longer consider enabled.

Impact:
- UI/backend drift
- confusing “screen appears but action fails” behavior
- harder rollout control during incidents

Recommendation:
- default risky/admin-heavy flags to disabled when the backend cannot be reached
- separate “safe UI defaults” from “authoritative server flags”

#### 5. The frontend still carries two overlapping login eras

Evidence:
- active route uses `LandingPage`: `frontend/src/App.jsx:121`, `frontend/src/App.jsx:135`
- legacy login file still exists: `frontend/src/pages/Login.jsx:8`
- `frontend/src/pages/Login.jsx:51`
- `frontend/src/pages/Login.jsx:93`
- `frontend/src/pages/LandingPage.jsx:31`
- `frontend/src/pages/LandingPage.jsx:41`
- `frontend/src/pages/LandingPage.jsx:221`

Problem:
The actual `/login` route renders `LandingPage`, which contains the current password-based login and forgot-password flow. But the older `Login.jsx` still exists and is PIN-oriented.

That means the codebase still contains two mental models for sign-in:
- legacy PIN-first screen
- current password-first landing page flow

Impact:
- onboarding friction for future maintainers
- higher risk of editing the wrong login path
- more migration leftovers than the route tree suggests

Recommendation:
- remove or explicitly archive the unused login path
- keep one canonical authentication entrypoint per runtime mode

### Low

#### 6. `App.jsx` is becoming a central registry bottleneck

Evidence:
- `frontend/src/App.jsx`

Problem:
The app shell is still readable, but `App.jsx` is doing a lot:
- route imports
- public/private/admin route wiring
- setup redirect logic
- route wrappers
- route fallback UI

This is manageable now, but it is already large enough to become a merge hotspot and a place where product rules quietly accumulate.

Recommendation:
- split route definitions by domain or shell
- keep `App.jsx` as a composition file instead of the full registry

#### 7. Configuration access is not fully centralized

Evidence:
- `frontend/src/config.js`
- `frontend/src/App.jsx:110`
- `frontend/src/contexts/CurrencyContext.jsx:4`
- `frontend/src/pages/ReceiptPublicPage.jsx:4`

Problem:
The repo has a central config file, but several modules still read `import.meta.env` directly or re-derive API bases in-place.

Impact:
- harder global config changes
- more risk of environment drift between pages

Recommendation:
- make `config.js` the single frontend config boundary

#### 8. Public and semi-public utility screens depend heavily on URL/query state

Evidence:
- `frontend/src/pages/ReceiptPublicPage.jsx`
- `frontend/src/pages/CustomerDisplayPage.jsx`
- `frontend/src/pages/SetupWizard.jsx`
- `frontend/src/pages/ResetPassword.jsx`
- `frontend/src/pages/SignupPage.jsx`

Problem:
This is not inherently wrong, but several pages depend directly on query parameters for tenant, token, payment, shift, or impersonation behavior. That makes flows easy to understand, but also increases the number of places where URL handling becomes part of application correctness.

Recommendation:
- keep these flows documented
- centralize URL parsing helpers for public flow pages

## Architectural Notes

### Auth Model

The frontend auth model is capable but transitional.

Good:
- a shared `AuthProvider` exists
- automatic header injection works for most app traffic
- token refresh handling is built in for the multi-tenant JWT path

Less good:
- global `window.fetch` patching is powerful but invasive
- admin auth lives outside the main auth model
- impersonation adds another session layer on top of both

If this app keeps growing, auth/session handling will benefit from becoming even more explicit and centralized.

### Offline/PWA Model

The POS offline queue is more disciplined than the service worker cache.

That distinction matters:
- the POS queue is explicit product behavior and keyed per employee
- the service worker cache is more implicit and therefore riskier

I would keep investing in the explicit queue and be much more conservative with the generic SW API cache.

### UI Migration State

The codebase is clearly mid-migration:
- route wrappers point to redesigned modules
- some legacy pages still exist
- some pages still carry older auth/header assumptions

This is normal, but it means the main frontend risk is not “bad code”; it is inconsistency across generations of code.

## Priority Recommendations

1. Remove or sharply reduce service-worker caching of authenticated API responses.
2. Fix `PrinterSettingsRedesign` to use the shared auth/session layer instead of `localStorage.getItem("employeeId") || "1"`.
3. Standardize session storage strategy across employee and admin flows.
4. Make feature-flag fallback behavior fail more safely for privileged modules.
5. Delete or clearly retire legacy login/page paths that are no longer routed.
6. Split route registration out of `App.jsx` before it becomes a long-term bottleneck.

## Final Assessment

If I were taking over this frontend, I would describe it as:

- product-rich
- more mature than a typical internal-tool React app
- clearly built by people solving real business workflows
- still in the middle of an architectural cleanup

The good news is that the hardest problems here are already solved: routing, auth shape, context flow, and POS offline behavior all exist. The next step is consolidation: fewer parallel paths, safer caching, and less browser-state ambiguity.
