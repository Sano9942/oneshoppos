# Auth — Claude Guide

- **3 files** — authentication layer for tenant + admin portals
- **`AuthProvider.jsx`** — exports `AuthProvider` + `useAuth()`. Patches `window.fetch` globally to auto-inject auth headers (`Authorization`, `x-employee-id`, context headers). Key behaviors:
  - Offline guard: returns 503 for non-GET when `!navigator.onLine`
  - Silent token refresh: on 401 with `TOKEN_EXPIRED`, refreshes once (shared promise lock prevents stampede)
  - Subscription detection: on 403 with `SUBSCRIPTION_EXPIRED`, sets status
  - Impersonation: detects `?impersonate_token=` on boot
  - `hasPerm("all_access")` is superuser — implies all permissions
  - Fetch interceptor only applies to URLs containing `/api/`
- **`authStore.js`** — localStorage key `"authSession"`. Exports: `readSession/writeSession/clearSession`, `readContext/writeContext/clearContext`, `readToken/writeToken`, `readTenantSlug`, `isSessionStructValid`. Also writes `localStorage.currentEmployee` for backward compatibility
- **`adminAuthStore.js`** — mirror for `/admin` portal. Key: `"adminSession"`. Exports: `readAdminSession/writeAdminSession/clearAdminSession/getAdminToken/getAdminSession`. Simpler — no context or token helpers
