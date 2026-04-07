# Routes — Claude Guide

- **4 files** — React Router route definitions split by access level
- **`publicRoutes.jsx`** — `/` (HomeRedirect — checks setup status), `/setup`, `/login`, `/reset-password`, `/signup`, `/receipt/:invoiceNumber`, `/access-denied`, `/context-select` (requires auth), `/pos` (requires auth + ErrorBoundary), `/kiosk`, `/customer-display`
- **`appRoutes.jsx`** — ~60+ lazy-loaded pages nested under `RequireAuth > RequireContext > AppLayoutRedesign`. Permission shortcuts via `perm(permString, element)` and `wrap(Component)` helpers
- **`adminRoutes.jsx`** — `/admin/login`, `/admin` (dashboard), `/admin/tenants`, `/admin/tenants/:id`, `/admin/support`, `/admin/emails`, `/admin/dead-letters`, `/admin/tax-rates`, `/admin/activity`. No `RequireAuth` — admin auth checked inside `AdminLayout` via `getAdminToken()`
- **`RouteLoading.jsx`** — centered "Loading..." box, used as `Suspense` fallback
