# Frontend — Claude Guide

## Architecture Quick Reference

- **Stack**: React 19 + Vite 7 + Tailwind CSS v4
- **All pages** are in `src/pages/redesign/` — always edit `*Redesign.jsx` files
- **Route files** (`*Route.jsx` in `pages/`) are 5-line thin wrappers — never edit these
- **App.jsx** is the route orchestrator — read this to understand routing
- **AuthProvider.jsx** patches `window.fetch` globally — all `/api/` calls get auth headers automatically

## DO NOT READ These Files (token waste)

### Route Wrappers (31 files — skip all, they are 5-line pass-throughs)
`AccountingRoute.jsx`, `ActionHistoryRoute.jsx`, `AdministratorRoute.jsx`, `AttributeSetsRoute.jsx`, `BackupRestoreRoute.jsx`, `BrandsRoute.jsx`, `CRMRoute.jsx`, `CashManagementRoute.jsx`, `CategoriesRoute.jsx`, `CompanySettingsRoute.jsx`, `CustomersRoute.jsx`, `DashboardRoute.jsx`, `EmployeesRoute.jsx`, `ExpensesRoute.jsx`, `HRManagementRoute.jsx`, `InventoryRoute.jsx`, `OrdersRoute.jsx`, `OutletsRoute.jsx`, `POSRoute.jsx`, `PromotionsRoute.jsx`, `PurchaseOrdersRoute.jsx`, `QuotationsRoute.jsx`, `ReturnedStockRoute.jsx`, `ReturnsRoute.jsx`, `SalesHistoryRoute.jsx`, `ShopifyIntegrationRoute.jsx`, `StockAdjustmentsRoute.jsx`, `SupplierPayablesRoute.jsx`, `SuppliersRoute.jsx`, `TaxesRoute.jsx`, `TransfersRoute.jsx`

Each one just does: `import XRedesign from './redesign/XRedesign'; export default function XRoute() { return <XRedesign />; }`

### Legacy Original Pages (8 files — only read if editing their redesign wrapper)
`Accounting.jsx`, `Approvals.jsx`, `Attendance.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx`, `InvoiceView.jsx` — these are imported by their Redesign counterparts. Do NOT delete them, but don't read them unless you need to understand the wrapped component.

`Reports.jsx` is NOT legacy — it's the active reports orchestrator (delegates to `pages/reports/` modules).

## Where to Look Instead

| Need | Read This |
|------|-----------|
| Routing & guards | `App.jsx` |
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
| API base URL | `config.js` |
| POS state & logic | `pages/redesign/pos/POSContext.jsx` |
| Dashboard modules | `pages/dashboard/*.jsx` |
| Report modules | `pages/reports/*.jsx` |
| Shopify modules | `pages/shopify/*.jsx` |
| Admin panel | `pages/admin/*.jsx` |

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
- All fetch calls to URLs containing `/api/` get auth headers injected automatically by `AuthProvider.jsx`
- Always use `${API}/api/<route>` — missing `/api/` prefix means no headers injected
- Do NOT manually set `x-employee-id` or `Authorization` headers — the interceptor does it
- `API` is imported from `../config` (or `../../config` depending on depth)
- **Silent refresh**: On 401 with `TOKEN_EXPIRED`, interceptor calls `POST /api/auth/refresh` via `window._nativeFetch`, stores new token, retries original request. Uses `_refreshPromise` lock to prevent concurrent refreshes.
- **Do NOT add `token` to `useEffect` deps** — interceptor reads it live via `readToken()`. Adding it causes re-wrapping on every refresh.

### Primitives API
- `PageShell` props: `title`, `subtitle`, `right` — **no `actions` prop**
- `SectionCard` props: `children`, `className` only — **no `title` prop**

### POS Architecture
- All POS state lives in `POSContext.jsx` (128+ exports)
- New POS components must call all hooks BEFORE any conditional early return
- Mount new POS modals in `POSRedesign.jsx`
- `POST /api/sales` requires active shift + clocked-in employee
- Stock deduction uses `item.variant_id` for variant stock, `item.id` for `outlet_stock` — always pass `variant_id` when known
- Receipt rendering: **all logic in `utils/receipt.js`** — `buildReceiptSections`, `buildReceiptHtml`, `printToHardware`; `POSContext.printSlip` tries hardware first, falls back to browser popup
- POS Recent Sales + Return/Exchange: `POSRecentSalesPanel.jsx` + `POSReturnExchangeModal.jsx`
- POS Session Expired: `POSSessionExpiredModal.jsx` — shown on 401 during checkout; PIN re-login auto-retries pending sale

### Admin Panel (separate auth system)
- Uses `adminFetch` from `AdminLogin.jsx` — NOT the global fetch interceptor
- Session stored in `localStorage["adminSession"]` — NOT `"authSession"`
- Routes at `/admin/*` bypass `RequireAuth`/`RequireContext`

## Test Suites

### Live E2E Tests (~120 tests — full stack against production)
- Location: `tests/live/` (20 Playwright specs, 00–19)
- Config: `playwright.config.live.js`
- Target: `https://sanopos.vercel.app` (tenant `packagesmall`)
- Run: `npx playwright test tests/live/NN-name.spec.js --config=playwright.config.live.js`
- Auth: global-setup saves token to `live-token.json` + `live-auth.json` (gitignored)
- State: shared across specs via `tests/live/helpers/state.js` → `state.json` (gitignored)
- Covers full POS day: shift→sale→return→gift card→shift close, plus inventory, purchasing, GRN, customers, loyalty, CRM, HR, attendance, kiosk, approvals, notifications, reports, accounting, audit log

### Other Tests
- Unit tests: `tests/unit/*.test.jsx`
- Dev E2E tests: `tests/e2e/*.spec.js` (against local dev server)
