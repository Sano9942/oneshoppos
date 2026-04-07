# Admin Pages — Claude Guide

- **10 files** — super-admin portal at `/admin`
- **`AdminLogin.jsx`** — login form + exports `adminFetch(path, options)` helper (injects Bearer from adminAuthStore). Other admin files import `{ adminFetch }` from here. **Exception**: `AdminTaxRates.jsx` defines its own local `adminFetch`
- **`AdminLayout.jsx`** — admin shell with sidebar. Checks `getAdminToken()` directly (no React context). Redirects to `/admin/login` if no token. Polls support ticket count every 30s for badge
- **`AdminDashboard.jsx`** — system metrics: tenant count, server stats, DB size, billing totals, announcements CRUD
- **`AdminTenantList.jsx`** — paginated tenant list with search, create, CSV export
- **`AdminTenantDetail.jsx`** — full tenant detail: feature flags toggle, impersonation, suspend/delete, employee list, support tickets
- **`AdminSupportTickets.jsx`** — ticket queue with status tabs, reply, resolve, delete
- **`AdminEmails.jsx`** — email send log with status filters, retry, delete, CSV export
- **`AdminDeadLetters.jsx`** — failed webhook/job queue with retry/retry-all, auto-polls
- **`AdminTaxRates.jsx`** — global tax rate seeder (pre-fills tenant tax tables)
- **`AdminActivity.jsx`** — three tabs: Admin Actions, Tenant Activity, Security; CSV export
- **Auth pattern**: Uses `adminFetch` (NOT `api.js`). Separate session from tenant auth
