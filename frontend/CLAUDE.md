# Frontend — Claude Guide

## Architecture Quick Reference

- **Stack**: React 19 + Vite 7 + Tailwind CSS v4
- **Most tenant pages** are in `src/pages/redesign/` — edit `*Redesign.jsx` files for normal business logic
- **Pages outside redesign/** (active, not legacy): `LandingPage.jsx`, `SignupPage.jsx`, `ResetPassword.jsx`, `/public/`, `/portal/`, `/storefront/`, `/admin/`
- **Landing page**: `src/pages/LandingPage.jsx` — public one-pager with competitive positioning, pricing (2-tier: Free + Pro), login
- **Route files** (`*Route.jsx` in `pages/`) are 5-line thin wrappers — never edit these
- **App.jsx** is the route orchestrator (composition only) — route definitions live in `routes/publicRoutes.jsx`, `routes/appRoutes.jsx`, `routes/adminRoutes.jsx`
- **AuthProvider.jsx** patches `window.fetch` globally — all `/api/` calls get auth headers automatically

## DO NOT READ These Files (token waste)

### Route Wrappers (64 files — skip all, they are 5-line pass-throughs)
Any `pages/*Route.jsx` file. Each one just does:
`import XRedesign from './redesign/XRedesign'; export default function XRoute() { return <XRedesign />; }`

Examples: `POSRoute.jsx`, `DashboardRoute.jsx`, `CustomersRoute.jsx`, `OrdersRoute.jsx`, `InventoryRoute.jsx`, `ReportsRoute.jsx`, and all Wave-16 additions (`AppointmentsRoute`, `CommissionPlansRoute`, `ContractsRoute`, `CustomerInvoicesRoute`, `KDSRoute`, `LoyaltyTiersRoute`, `MarketingCampaignsRoute`, `MessagingInboxRoute`, `OutletTaxProfilesRoute`, `POSLayoutsRoute`, `ProjectsRoute`, `ReportBuilderRoute`, `RestaurantChecksRoute`, `RestaurantFloorRoute`, `ReturnPoliciesRoute`, `ScheduledChangesRoute`, `SchedulingRoute`, `SmartCollectionsRoute`, `SubscriptionsRoute`, `CODSettlementsRoute`, `KioskOrderingRoute`, …). If it matches `*Route.jsx` in `pages/`, do not read it.

### Legacy Original Pages (8 files — only read if editing their redesign wrapper)
`Accounting.jsx`, `Approvals.jsx`, `Attendance.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx`, `InvoiceView.jsx` — these are imported by their Redesign counterparts. Do NOT delete them, but don't read them unless you need to understand the wrapped component.

`Reports.jsx` is NOT legacy — it's the active reports orchestrator (delegates to `pages/reports/` modules).

### Active pages outside `redesign/`
- `LandingPage.jsx` — public landing page (signup, login links)
- `SignupPage.jsx` — public self-service signup
- `ResetPassword.jsx` — public password reset
- `ReceiptPublicPage.jsx` — public shareable receipt view
- `public/` — unauthenticated pages (error pages, etc.)
- `portal/` — customer self-service portal (separate auth)
- `storefront/` — embedded storefront for Orders feature
- `admin/` — super-admin panel (10 files, separate auth system)

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
| API base URL + env flags | `config.js` — `API_BASE`, `IS_MULTI_TENANT`, `SENTRY_DSN`, `ENV_MODE`, `IS_PROD`, `IS_DEV` |
| Centralized API calls | `api.js` — `api.get/post/put/del/upload/raw`; handles URL construction, auth headers, JSON parsing, error normalization |
| Admin session storage | `auth/adminAuthStore.js` — admin session helpers (extracted from AdminLogin.jsx) |
| TypeScript types | `types/auth.ts`, `types/api.ts` — shared shape declarations (tsconfig: allowJs + noEmit) |
| POS cart math | `pages/redesign/pos/cartMath.js` — pure cart calculation functions (extracted from POSContext for testability) |
| POS state & logic | `pages/redesign/pos/POSContext.jsx` |
| Dashboard modules | `pages/dashboard/*.jsx` |
| Report modules | `pages/reports/*.jsx` — also exports `ReportsTabStandaloneRedesign` from `redesign/ReportsRedesign.jsx` for deep-linked tabs |
| Report filter state | `hooks/useReportFilters.js` — shared filter state hook used by report tab components |
| Shopify modules | `pages/shopify/*.jsx` |
| Admin panel | `pages/admin/*.jsx` (10 files — login, layout, dashboard, tenant-list, tenant-detail, activity, emails, support-tickets, dead-letters, tax-rates) |
| Error boundary | `ui/ErrorBoundary.jsx` — **named export** `{ ErrorBoundary }`, not default — global + page-level |
| Support widget | `ui/SupportWidget.jsx` — floating ticket form |
| Star rating | `ui/StarRating.jsx` — two named exports: `StarDisplay` (read-only) + `StarPicker` (interactive) |
| API error type guard | `types/api.ts` — `isApiError(res)` runtime guard, narrows `ApiResponse` to error case |
| Standalone report deep-link | `routes/appRoutes.jsx` — 17 `/reports/:tabId` deep-link routes (e.g. `/reports/sales-summary`) |
| Industry preset labels/modes | `contexts/PresetContext.jsx` — `usePreset()` → `{ labels, hasMode, label, enabled_modes, unit_vocabulary, pos_layout_mode }` |
| Customer portal session | `auth/customerPortalStore.js` — slug-scoped portal session helpers (`readPortalSession`, `writePortalSession`, `clearPortalSession`, `getPortalToken`, `getPortalCustomer`) |
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
- **Use `api.js` for all authenticated tenant API calls** — `import api from '../api'` then `api.get('/products')`, `api.post('/sales', body)`, etc. Do NOT use raw `fetch()` in redesign pages.
- **Exceptions — these intentionally use raw `fetch()`**: `storefront/` pages (self-contained, no auth), `pages/public/` pages (unauthenticated), `hooks/useFeatureFlags.js` (called before interceptor may be wired)
- **Admin pages**: Check the specific admin page — some use `adminFetch` from `AdminLogin.jsx` (separate auth), others use raw `fetch`. Do NOT blindly replace with `api.js`
- All fetch calls to URLs containing `/api/` get auth headers injected automatically by `AuthProvider.jsx`
- **Interceptor skips**: non-`/api/` URLs, no authenticated employee, and public auth endpoints (`/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password`)
- Do NOT manually set `x-employee-id` or `Authorization` headers — the interceptor does it
- **`config.js` exports**: `API_BASE` (no `/api` suffix), `IS_MULTI_TENANT`, `SENTRY_DSN`, `ENV_MODE`, `IS_PROD`, `IS_DEV`. There is no `API` export — `AuthProvider.jsx` aliases `API_BASE as API` internally. `api.js` paths must include `/api/` prefix (e.g. `api.get("/api/products")`) for the auth interceptor to inject headers.
- `API_BASE` is imported from `../config` (or `../../config` depending on depth)
- **Silent refresh**: On 401 with `TOKEN_EXPIRED`, interceptor calls `POST /api/auth/refresh` via `window._nativeFetch`, stores new token, retries original request. Uses `_refreshPromise` lock to prevent concurrent refreshes.
- **Do NOT add `token` to `useEffect` deps** — interceptor reads it live via `readToken()`. Adding it causes re-wrapping on every refresh.

### Primitives API
- `PageShell` props: `title`, `subtitle`, `right` — **no `actions` prop**
- `SectionCard` props: `children`, `className` only — **no `title` prop**

### POS Architecture
- All POS state lives in `POSContext.jsx` (~143 exports)
- New POS components must call all hooks BEFORE any conditional early return
- Mount new POS modals in `POSRedesign.jsx`
- **ErrorBoundary** wraps `<POSContent />` inside `<POSProvider>` — crashes show recovery UI instead of white screen
- `POST /api/sales` requires active shift + clocked-in employee
- Stock deduction uses `item.variant_id` for variant stock, `item.id` for `outlet_stock` — always pass `variant_id` when known
- Receipt rendering: **all logic in `utils/receipt.js`** — `buildReceiptSections`, `buildReceiptHtml`, `printToHardware`; `POSContext.printSlip` tries hardware first, falls back to browser popup
- POS Recent Sales + Return/Exchange: `POSRecentSalesPanel.jsx` + `POSReturnExchangeModal.jsx`
- POS Session Expired: `POSSessionExpiredModal.jsx` — shown on 401 during checkout; PIN re-login auto-retries pending sale
- **`completeSale` uses `api.raw`** (not `api.post`) — must stay this way to detect 401 mid-checkout. Do NOT refactor to `api.post`.
- **Park sale is feature-flagged**: when `posFlags.phase2_draft_orders` is on, parks to `/api/draft-orders` instead of `/api/parked-sales`
- **Barcode scanner**: global keydown listener buffers rapid keystrokes with 100ms inter-key timeout; fires `handleBarcodeScanned` on `Enter` with buffer ≥ 3 chars
- **Customer price list takes priority** over outlet price list during price resolution
- **`POSApprovalModal` and `POSEmailReceiptModal`** receive all data via props — NOT from context. All other POS modals use context.
- **POS uses hardcoded colors** (`#8066FF`, `slate-*`, `#0A0A0A` sidebar) — NOT design system CSS variables. Exception: `POSShortcutsOverlay`, `EndlessAisleModal`, `POSApprovalModal` use CSS variables.

### CSV Export
- Shared utility exists: `utils/csvExport.js` — `downloadCsv(headers, rows, filename)`
- **Status**: NOT yet universally adopted. Some table pages still create Blob inline (InventoryRedesign, CustomersRedesign, OrdersRedesign, SalesHistoryRedesign)
- **New pages MUST use the shared utility**, not inline blob code
- Exports visible/filtered rows (respects user's current search/filter)
- Refactor existing tables to use `downloadCsv` when touching them

### Feature Flag Gating (Apr 1 2026)
- `useFeatureFlags(authHeaders)` hook from `hooks/useFeatureFlags.js` — returns `{ flags, loading }`
- Uses raw `fetch()` directly (NOT `api.js`) — intentional, some callers run before interceptor is wired
- **Do NOT pass an inline `{}` object as `authHeaders` each render** — it creates a new reference every render and causes an infinite loop. Hoist or memoize the value first.
- **Approvals page** (`ApprovalsRedesign.jsx`) checks `flags.approvals` and redirects to `/` if off
- **Kiosk page** (`KioskRedesign.jsx`) gracefully handles 401 on feature-flags fetch (`if (!r.ok) return { flags: [] }`)
- No `RequireFeature` wrapper component exists — feature-flag checks are done inside individual page components
- When adding feature-flagged pages, check the flag inside the component and redirect if off

### Timestamps — additional gotcha
- `pg` driver returns UTC columns as native JS `Date` objects (not strings). Both `fmtUtcDateTime` and `fmtLocalDateTime` handle this. Legacy SQLite strings also handled.
- `receipt.js` slip builder expects `slip.timestamp` as a **pre-formatted display string** — call `fmtDateTime()` before passing, do NOT pass a raw DB value.

### Polling rates (do not guess these)
| Component | Rate | Notes |
|-----------|------|-------|
| `DashboardRedesign` | 60s | Full data refresh via `refreshKey` |
| `NotificationBell` | 60s | Count only; full rows fetched on open |
| Admin pages | 30s | All admin pages except `AdminTaxRates` (no polling) |
| `AdminLayout` support badge | 60s | Separate from admin page refresh |
| `InfrastructurePanel` | 30s | Inside `AdminDashboard` |

### MT mode setup wizard skip
- `HomeRedirect` (in `appRoutes`) skips the setup wizard check when `IS_MULTI_TENANT = true` — tenants go straight to dashboard

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

## Common Patterns (checklists — don't re-research these)

### Adding a new page
1. Create `pages/redesign/<Name>Redesign.jsx` — use `PageShell`, `api.js`, `useCurrency()`, `useAuth()`
2. Create `pages/<Name>Route.jsx` — 5-line thin wrapper: `import X from './redesign/XRedesign'; export default function XRoute() { return <X />; }`
3. Add route to `routes/appRoutes.jsx` — lazy import + `<Route path="/<path>" element={<RequireAuth><RequirePerm perm="..."><XRoute /></RequirePerm></RequireAuth>} />`
4. Add nav entry to `ui/nav-config.js` — `{ label: "Name", path: "/<path>", icon: LucideIcon }`
5. Add breadcrumb label to `ui/Breadcrumbs.jsx` — add `"<path>": "Display Name"` to LABELS object
6. Update `DOMAIN-MAP.md` with the new domain entry

### Adding a new admin page
1. Create `pages/admin/Admin<Name>.jsx` — use `adminFetch` (NOT `api.js`), separate auth system
2. Add route to `routes/adminRoutes.jsx`
3. Add nav entry to `AdminLayout.jsx` sidebar
4. Backend: add to `routes/admin/<module>.js`, guard with `requireSuperAdmin`

### Adding a new report tab
1. Create `pages/reports/Reports<Name>.jsx`
2. Register in `pages/Reports.jsx` tab config
3. Backend: add to `routes/reports/<name>.js`, guard with `view_reports`
- **Date param naming is inconsistent** — most report tabs use `date_from`/`date_to`; `ReportsMultichannel` and `FBRExportTab` use `from`/`to`. Match whichever convention the backend route expects.
- **Shift-locked tabs** skip date params entirely and use `session_id` instead.

### Adding a new Shopify tab
1. Create `pages/shopify/Shopify<Name>.jsx`
2. Register in `ShopifyIntegrationRedesign.jsx` tab config
3. Use `ShopifyContext` for shared state

## Provider Hierarchy & Hooks

```
ErrorBoundary
  └─ CurrencyProvider  → useCurrency()  — available everywhere
       └─ ToastProvider  → useToast()   — available everywhere
            └─ AuthProvider  → useAuth()  — available inside authenticated routes
                 └─ PresetProvider  → usePreset()  — available inside authenticated routes
                      └─ App (BrowserRouter)
```

### Available hooks
| Hook | Source | Returns |
|------|--------|---------|
| `useToast()` | `contexts/ToastContext.jsx` | `{ toast, success, error, warning }` — max 3 visible, 4s auto-dismiss |
| `useCurrency()` | `contexts/CurrencyContext.jsx` | `{ symbol, code, fmt, refresh, denominations }` |
| `useAuth()` | `auth/AuthProvider.jsx` | `{ session, employee, permissions, isAuthenticated, isBootstrapping, login, logout, refreshPermissions, refreshAccessToken, hasPerm, authHeaders, token, isImpersonating, impersonationTenantName, impersonationSessionId, subscriptionStatus, subscriptionDaysLeft }` |
| `useFeatureFlags()` | `hooks/useFeatureFlags.js` | `{ flags, loading }` |
| `usePreset()` | `contexts/PresetContext.jsx` | `{ labels, preset, presetLoaded, updatePreset, hasMode, label, enabled_modes, unit_vocabulary, pos_layout_mode }` |

### API patterns
| Pattern | Usage |
|---------|-------|
| `api.get('/products')` | Authenticated tenant API call |
| `api.post('/sales', body)` | POST with JSON body |
| `api.put('/products/1', body)` | PUT with JSON body |
| `api.del('/products/1')` | DELETE |
| `api.upload('/support/upload', formData)` | Multipart file upload |
| `adminFetch('/admin/tenants')` | Admin-only API call (separate auth) |

## Error Handling Conventions

- **api.js** intercepts `401` responses → auto-logout (or silent token refresh if `TOKEN_EXPIRED`)
- **All other errors** throw with `err.message` containing the server's `{ error }` string
- **Page-level pattern**: `catch(err) { toast.error(err.message || "Something went wrong") }`
- **ErrorBoundary** (`ui/ErrorBoundary.jsx`) catches React render errors — global (full-page) + page-level (compact card)
- **Never swallow errors silently** — always show toast or log to console

## Test Suites

### Production E2E Tests (43 specs, full system audit)
- Location: `tests/*.spec.js` (43 self-contained Playwright specs)
- Config: `playwright.config.js` (single config, production target)
- Target: `https://sanopos.com` (tenant `packagesmall`)
- Run: `npx playwright test tests/auth.spec.js`
- Global setup: `global-setup.js` logs in once, saves `auth.json` + `token.json` (gitignored)
- Helpers: `helpers/auth.js` (credentials), `helpers/api.js` (REST), `helpers/nav.js` (navigation)
- Self-contained: each spec sets up its own data via API, no shared state
- Includes 6 onboarding specs (`onboard-free`, `onboard-starter`, `onboard-pro`, `onboard-dental-clinic`, `onboard-physiotherapy`, `onboard-veterinary`) — create real test tenants, **delete from `/admin` after each run**
- Key gotchas:
  - Login form is `LandingPage.jsx` — placeholders are `"e.g. aceshardware"` / `"Enter your password"` / button `"Sign In"`
  - Clock-in: use `/api/attendance/pin-checkin?tenant=${slug}` with `{ pin_code, outlet_id }` — NOT `/clock-in`
  - Health check: use simple `/api/health` (no `?deep=true` — no tenant context available)

### Smoke Tests (15 specs — competitive feature coverage)
- Location: `tests/smoke/` — bookings, catalog-advanced, commissions-reports, draft-orders-returns, insights-dashboard, invoicing-subscriptions, marketing-messaging, omnichannel-admin, phase5-pakistan, pricing-promotions, restaurant, service-workspace, storefront-public, workforce, + 1 additional
- Smoke helpers: `tests/smoke/helpers/` — cleanup, featureFlags, mockPaymentGateway, smokeRunId

### Unit Tests (~72 tests)
- Location: `tests/unit/` — `auth_guards`, `contexts`, `layout`, `primitives`, `dental_chart`
- Run: `npx vitest run tests/unit/` (vitest with @vitest/coverage-v8)
- Note: `contexts.test.jsx` tests `cartMath.js` functions (calcGrossTotal, calcDiscountValue, calcTaxTotal, calcTotal) + `CurrencyContext` — no POSContext hook unit tests exist
