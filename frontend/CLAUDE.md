# Frontend — Claude Guide

## Architecture Quick Reference

- **Stack**: React 19 + Vite 7 + Tailwind CSS v4
- **All pages** are in `src/pages/redesign/` — always edit `*Redesign.jsx` files
- **Landing page**: `src/pages/LandingPage.jsx` — public one-pager with competitive positioning, pricing (2-tier: Free + Pro), login
- **Route files** (`*Route.jsx` in `pages/`) are 5-line thin wrappers — never edit these
- **App.jsx** is the route orchestrator (composition only) — route definitions live in `routes/publicRoutes.jsx`, `routes/appRoutes.jsx`, `routes/adminRoutes.jsx`
- **AuthProvider.jsx** patches `window.fetch` globally — all `/api/` calls get auth headers automatically

## DO NOT READ These Files (token waste)

### Route Wrappers (35 files — skip all, they are 5-line pass-throughs)
`AccountingRoute.jsx`, `ActionHistoryRoute.jsx`, `AdministratorRoute.jsx`, `AttributeSetsRoute.jsx`, `BackupRestoreRoute.jsx`, `BrandsRoute.jsx`, `CRMRoute.jsx`, `CashManagementRoute.jsx`, `CategoriesRoute.jsx`, `CompanySettingsRoute.jsx`, `CustomersRoute.jsx`, `DashboardRoute.jsx`, `EmployeesRoute.jsx`, `ExpensesRoute.jsx`, `FBRDashboardRoute.jsx`, `FBRSettingsRoute.jsx`, `HRManagementRoute.jsx`, `InventoryRoute.jsx`, `OrdersRoute.jsx`, `OutletsRoute.jsx`, `POSRoute.jsx`, `PromotionsRoute.jsx`, `PurchaseOrdersRoute.jsx`, `QuotationsRoute.jsx`, `ReturnedStockRoute.jsx`, `ReturnsRoute.jsx`, `SalesHistoryRoute.jsx`, `ShopifyIntegrationRoute.jsx`, `StockAdjustmentsRoute.jsx`, `SupplierPayablesRoute.jsx`, `SuppliersRoute.jsx`, `TaxesRoute.jsx`, `TaxLookupRoute.jsx`, `TransfersRoute.jsx`

Each one just does: `import XRedesign from './redesign/XRedesign'; export default function XRoute() { return <XRedesign />; }`

### Legacy Original Pages (8 files — only read if editing their redesign wrapper)
`Accounting.jsx`, `Approvals.jsx`, `Attendance.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx`, `InvoiceView.jsx` — these are imported by their Redesign counterparts. Do NOT delete them, but don't read them unless you need to understand the wrapped component.

`Reports.jsx` is NOT legacy — it's the active reports orchestrator (delegates to `pages/reports/` modules).

## Where to Look Instead

| Need | Read This |
|------|-----------|
| Routing & guards | `App.jsx` (composition) + `routes/publicRoutes.jsx`, `routes/appRoutes.jsx`, `routes/adminRoutes.jsx` (definitions) |
| Auth, token refresh, fetch interceptor | `auth/AuthProvider.jsx` |
| Token storage helpers | `auth/authStore.js` |
| Design system primitives | `ui/primitives.jsx` |
| Nav menu config | `ui/nav-config.js` |
| Currency formatting | `contexts/CurrencyContext.jsx` — use `useCurrency()` |
| Feature flags | `hooks/useFeatureFlags.js` |
| Date/time formatting | `utils/dates.js` |
| Receipt rendering | `utils/receipt.js` |
| Category tree UI | `utils/categoryTree.js` |
| Offline queue | `utils/offlineQueue.js` |
| CSV export | `utils/csvExport.js` — `downloadCsv(headers, rows, filename)` |
| API base URL | `config.js` |
| Centralized API calls | `api.js` — `api.get/post/put/del/upload/raw`; handles URL construction, auth headers, JSON parsing, error normalization |
| Admin session storage | `auth/adminAuthStore.js` — admin session helpers (extracted from AdminLogin.jsx) |
| TypeScript types | `types/auth.ts`, `types/api.ts` — shared shape declarations (tsconfig: allowJs + noEmit) |
| POS cart math | `pages/redesign/pos/cartMath.js` — pure cart calculation functions (extracted from POSContext for testability) |
| POS state & logic | `pages/redesign/pos/POSContext.jsx` |
| Dashboard modules | `pages/dashboard/*.jsx` |
| Report modules | `pages/reports/*.jsx` |
| Shopify modules | `pages/shopify/*.jsx` |
| Admin panel | `pages/admin/*.jsx` (11 files — dashboard, tenants, activity, emails, support, dead-letters, tax-rates) |
| Error boundary | `ui/ErrorBoundary.jsx` — global + page-level |
| Support widget | `ui/SupportWidget.jsx` — floating ticket form |
| Impersonation banner | `ui/ImpersonationBanner.jsx` — amber bar during impersonation |
| Announcement banner | `ui/AnnouncementBanner.jsx` — platform announcements, dismissible per session |
| Subscription banner | `ui/SubscriptionBanner.jsx` — global trial countdown / grace warning / expired state banner |
| My Tickets page | `pages/redesign/MyTicketsRedesign.jsx` — tenant-side support ticket viewer + admin replies |
| Tenant billing page | `pages/redesign/BillingRedesign.jsx` — trial countdown, Pay Now (gateway), payment history, upgrade requests |
| FBR settings | `pages/redesign/FBRSettingsRedesign.jsx` — NTN, token, province, enable toggle |
| FBR invoice queue | `pages/redesign/FBRDashboardRedesign.jsx` — summary cards, filters, retry, auto-refresh |
| Tax rate lookup | `pages/redesign/TaxLookupRedesign.jsx` — province-aware search, export, suggest correction |
| Admin tax rates | `pages/admin/AdminTaxRates.jsx` — super-admin CRUD + suggestion review |

## Efficiency Rules

- **Read only the specific `*Redesign.jsx` needed** — never read the whole `redesign/` folder. If fixing a billing bug, read `BillingRedesign.jsx` only
- **Don't read App.jsx** — routing and guards are documented in this file. Only read it if the task is explicitly about route structure or auth guards
- **Don't read primitives.jsx** — `PageShell`, `SectionCard`, `Button`, `Input` props are documented above. Only read it if using a primitive not listed there
- **One reference component** — when adding a new page, read ONE similar existing `*Redesign.jsx` as a pattern reference, not multiple
- **Grep before read** — use Grep to find the exact component/hook/state before opening any file
- **Don't re-read after edit** — after a successful Edit, don't re-read the file to verify. Trust the tool

## Key Conventions

### Tailwind v4 (linter enforced)
- `(--css-var)` NOT `[var(--css-var)]`
- `shrink-0` NOT `flex-shrink-0`, `grow` NOT `flex-grow`
- `bg-linear-to-br` NOT `bg-gradient-to-br`
- `z-200` NOT `z-[200]`

### Timestamps (CRITICAL — recurring bug source)
- **UTC columns** (sales, returns, shifts, adjustments): use `fmtUtcDateTime` / `fmtUtcDate` / `fmtUtcTime` from `utils/dates.js`
- **LOCAL columns** (attendance, expenses, GRN, parked_sales): use `fmtLocalDateTime` / `fmtLocalDate` / `fmtLocalTime` from `utils/dates.js`
- **NEVER** use raw `new Date(timestamp)` on any DB value
- **Exception**: `new Date(d + "T00:00:00")` is OK only for `YYYY-MM-DD` display labels

### Currency (NEVER hardcode)
- Use `const { fmt } = useCurrency()` in components
- Pass `currencySymbol` as param in non-component utilities (e.g., `receipt.js`)

### API Calls
- **Use `api.js` for all API calls** — `import api from '../api'` then `api.get('/products')`, `api.post('/sales', body)`, etc. Do NOT use raw `fetch()` in non-admin pages.
- Admin pages use `adminFetch` from `AdminLogin.jsx` — separate auth system, do NOT replace with `api.js`
- All fetch calls to URLs containing `/api/` get auth headers injected automatically by `AuthProvider.jsx`
- Do NOT manually set `x-employee-id` or `Authorization` headers — the interceptor does it
- **`config.js` gotcha**: `API` export = `${API_BASE}/api` (already includes `/api`). Never do `${API}/api/...` — produces double prefix → 404. Use `api.js` or import `API_BASE` and append `/api/...` yourself.
- `API_BASE` is imported from `../config` (or `../../config` depending on depth)
- **Silent refresh**: On 401 with `TOKEN_EXPIRED`, interceptor calls `POST /api/auth/refresh` via `window._nativeFetch`, stores new token, retries original request. Uses `_refreshPromise` lock to prevent concurrent refreshes.
- **Do NOT add `token` to `useEffect` deps** — interceptor reads it live via `readToken()`. Adding it causes re-wrapping on every refresh.

### Primitives API
- `PageShell` props: `title`, `subtitle`, `right` — **no `actions` prop**
- `SectionCard` props: `children`, `className` only — **no `title` prop**

### POS Architecture
- All POS state lives in `POSContext.jsx` (128+ exports)
- New POS components must call all hooks BEFORE any conditional early return
- Mount new POS modals in `POSRedesign.jsx`
- **ErrorBoundary** wraps `<POSContent />` inside `<POSProvider>` — crashes show recovery UI instead of white screen
- `POST /api/sales` requires active shift + clocked-in employee
- Stock deduction uses `item.variant_id` for variant stock, `item.id` for `outlet_stock` — always pass `variant_id` when known
- Receipt rendering: **all logic in `utils/receipt.js`** — `buildReceiptSections`, `buildReceiptHtml`, `printToHardware`; `POSContext.printSlip` tries hardware first, falls back to browser popup
- POS Recent Sales + Return/Exchange: `POSRecentSalesPanel.jsx` + `POSReturnExchangeModal.jsx`
- POS Session Expired: `POSSessionExpiredModal.jsx` — shown on 401 during checkout; PIN re-login auto-retries pending sale

### CSV Export
- Shared utility: `utils/csvExport.js` — `downloadCsv(headers, rows, filename)`
- Every table page has an "Export CSV" button using `<Download>` icon from lucide-react
- New pages MUST use the shared utility, not inline blob code
- Exports visible/filtered rows (respects user's current search/filter)

### Feature Flag Gating (Apr 1 2026)
- `useFeatureFlags(authHeaders)` hook from `hooks/useFeatureFlags.js` — returns `{ flags, loading }`
- **Approvals page** (`ApprovalsRedesign.jsx`) checks `flags.approvals` and redirects to `/` if off
- **Kiosk page** (`KioskRedesign.jsx`) gracefully handles 401 on feature-flags fetch (`if (!r.ok) return { flags: [] }`)
- No `RequireFeature` wrapper component exists — feature-flag checks are done inside individual page components
- When adding feature-flagged pages, check the flag inside the component and redirect if off

### Admin Panel (separate auth system)
- Uses `adminFetch` from `AdminLogin.jsx` — NOT the global fetch interceptor
- Session helpers in `auth/adminAuthStore.js` (extracted from AdminLogin.jsx)
- Session stored in `localStorage["adminSession"]` — NOT `"authSession"`
- Routes at `/admin/*` bypass `RequireAuth`/`RequireContext`
- `AdminDashboard.jsx` includes `InfrastructurePanel` — DB connections, cache hit ratio, table health, slow queries (30s auto-refresh)
- `AdminSupportTickets.jsx` — cross-tenant support ticket viewer with status management, quick-impersonate, reply, delete
- `AdminDeadLetters.jsx` — failed webhook events with retry/dismiss actions
- `AdminTenantDetail.jsx` — includes impersonation, payment recording, billing, feature flag toggles, tenant notes, plan pricing editor
- `AdminActivity.jsx` — 3-tab activity log (admin actions, tenant activity, security log) with CSV export
- `AdminEmails.jsx` — email queue with delete, send now, purge, retry, broadcasts tab, CSV export

## Test Suites

### Live E2E Tests (~120 tests — full stack against production)
- Location: `tests/live/` (20 Playwright specs, 00–19)
- Config: `playwright.config.live.js`
- Target: `https://sanopos.com` (tenant `packagesmall`)
- Run: `npx playwright test tests/live/NN-name.spec.js --config=playwright.config.live.js`
- Auth: global-setup saves token to `live-token.json` + `live-auth.json` (gitignored)
- State: shared across specs via `tests/live/helpers/state.js` → `state.json` (gitignored)
- Covers full POS day: shift→sale→return→gift card→shift close, plus inventory, purchasing, GRN, customers, loyalty, CRM, HR, attendance, kiosk, approvals, notifications, reports, accounting, audit log

### Onboarding E2E Tests (45 tests — 3 plans × 15 steps, confirmed 45/45 PASS Mar 28 2026)
- Location: `tests/live/` (specs 21–23: `21-onboard-free`, `22-onboard-starter`, `23-onboard-pro`)
- Config: `playwright.config.onboarding.js` (no globalSetup — works without existing tenant)
- Run: `npx playwright test tests/live/2N-onboard-*.spec.js --config=playwright.config.onboarding.js`
- Shared helpers: `tests/live/helpers/onboarding.js` (all step functions), `tests/live/helpers/state.js` (state.json)
- Creates real test tenants — **delete from `/admin` after each run**
- Key gotchas:
  - Login form is `LandingPage.jsx` — placeholders are `"e.g. aceshardware"` / `"Enter your password"` / button `"Sign In"`
  - Clock-in: use `/api/attendance/pin-checkin?tenant=${slug}` with `{ pin_code, outlet_id }` — NOT `/clock-in`
  - Health check: use simple `/api/health` (no `?deep=true` — no tenant context available)
- Test log: `tests/live/../../../docs/test-logs/2026-03-28-onboarding-tests.md`

### Unit Tests (37 tests)
- Location: `tests/unit/` — auth guards, layout, primitives, CurrencyContext, cartMath, POSContext hooks
- Run: `npx vitest run tests/unit/` (vitest with @vitest/coverage-v8)

### Dev E2E Tests
- Location: `tests/e2e/*.spec.js` (against local dev server)
