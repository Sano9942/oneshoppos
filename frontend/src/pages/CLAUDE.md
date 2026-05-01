# Pages — Claude Guide

`pages/` contains all UI pages. Most active tenant UI lives in `redesign/`. Subdirectories each have their own CLAUDE.md with full detail.

---

## Subdirectory Modules

### `redesign/` — Primary tenant UI

All active tenant pages are `*Redesign.jsx` files here. The real implementations — edit these, not the `*Route.jsx` wrappers.

**Conventions:**
- Use `PageShell` (props: `title`, `subtitle`, `right`) and `SectionCard` (props: `children`, `className` only — no `title` prop) from `ui/primitives.jsx`
- All API calls via `api.js` (`api.get/post/put/del`) — never raw `fetch()`
- Feature flag gating: `const { flags, loading } = useFeatureFlags(authHeaders)` → check flag → `<Navigate to="/" replace />` if off. Do NOT pass inline `{}` as `authHeaders` each render (causes infinite loop). No `RequireFeature` wrapper component exists.
- Currency: `const { fmt } = useCurrency()` — never hardcode symbols
- Timestamps: `fmtUtcDateTime`/`fmtLocalDateTime` from `utils/dates.js` — never raw `new Date()`. Exception: `KioskRedesign` uses `fmtLocalTime` + `parseLocalDate` (attendance is LOCAL time)
- CSV export: `downloadCsv(headers, rows, filename)` from `utils/csvExport.js`. Exception: `ReportsPowerUpPanel` has its own inline `toCsv()` with metadata headers.

**Key pages:**
- `POSRedesign.jsx` — POS entry point. Wraps `POSContent` with `<POSProvider>` + `<ErrorBoundary>`. All 12 modals mounted here. `completeSale` uses `api.raw` — do not refactor to `api.post`.
- `DashboardRedesign.jsx` — role-aware orchestrator, auto-refreshes every 60s. `isAdmin`=`all_access`, `isManager`=`view_reports` without `all_access`.
- `ReportsRedesign.jsx` — thin wrapper. Exports default `ReportsRedesign` + named `ReportsTabStandaloneRedesign({ tabId })` for deep-linked tab routes.
- `BillingRedesign.jsx` — polls `GET /api/billing/status` every 2s up to 15 attempts after payment gateway redirect.
- `KioskRedesign.jsx` — public route (no auth). Reads `?tenant=<slug>` + `?outlet=<id>`. PIN entry via `POST /api/attendance/pin-status`.
- `ProfileRedesign.jsx` — self-service, no admin perm required. PIN (`PUT /api/employees/:id/change-pin`) + password change.
- `IntegrationsHubRedesign.jsx` — 12 providers in `PROVIDER_META`. Shopify + WooCommerce use `link` to navigate to dedicated pages rather than inline form.
- `ImportRedesign.jsx` — 5 tabs (products, customers, suppliers, expenses, payments). Template download uses `API_BASE` directly (raw file download, not `api.js`). Resets file input on tab switch.
- `CODSettlementsRedesign.jsx` — 3-view state machine (list → import → detail). Feature-flagged `phase5_cod_settlements`. Approve requires `all_access` perm only.
- `ProductFormPage.jsx` — standalone product create/edit. NOT a `*Redesign.jsx`. Uses `useParams()` for edit mode.
- `CustomersRedesign.jsx` — customer list + detail panel (Profile, Ledger, Order History). Clinical presets: `CLINICAL_PRESETS = { clinic, dental_clinic, veterinary, physiotherapy }` show medical fields when `industryType` matches.

**Feature-flagged pages** (follow standard pattern: check flag → redirect if off):

| Pages | Flag |
|-------|------|
| `AppointmentsRedesign`, `AppointmentsCalendarRedesign`, `AppointmentServicesRedesign` | `phase4_appointments` |
| `RestaurantChecksRedesign`, `RestaurantFloorRedesign`, `KioskOrderingRedesign` | `phase4_restaurant` |
| `KDSRedesign` | `phase4_restaurant_kds` |
| `TreatmentPlansRedesign` | `phase4_treatment_plans` + `manage_treatment_plans` perm |
| `ContractsRedesign` | `phase4_service_contracts` |
| `ProjectsRedesign` | `phase4_service_projects` |
| `CustomerInvoicesRedesign`, `SubscriptionsRedesign` | `customer_invoicing` / `subscription_billing` |
| `MarketingCampaignsRedesign`, `MessagingInboxRedesign` | `marketing_campaigns` / `customer_messaging` |
| `CommissionPlansRedesign` | `phase2_commissions` |
| `ChartOfAccountsRedesign`, `JournalEntriesRedesign`, `CreditDebitNotesRedesign`, `PostdatedChequesRedesign` | `accounting_core` |
| `RoomManagementRedesign` | `phase4_room_management` |
| `RentalsRedesign` | `phase4_rentals` + `manage_rentals` perm |
| `ServiceTicketsRedesign` | `phase4_workflow_tickets` |
| `ApprovalsRedesign` | `approvals` |
| `ReportBuilderRedesign` | `phase2_report_builder` |

**Subdirectories inside `redesign/`:**
- `pos/` — `POSContext.jsx` (~143 exports, all POS state), `POSShortcutsOverlay.jsx`, `cartMath.js` (pure cart math, extracted for testability)
- `cod/` — 7 files for COD settlement sub-views (BatchList, BatchDetail, BatchHeaderCard, LineTable, ManualMatchModal, ApproveConfirmModal, ImportWizard)
- `treatment/` — `DentalChart`, `BodyChart` used by `TreatmentPlansRedesign`

---

### `admin/` — Super-admin panel

Routes at `/admin/*`. Separate auth system — uses `adminFetch` from `AdminLogin.jsx` (NOT `api.js`). Session in `localStorage["adminSession"]`. Dark violet/slate-900 theme.

**Key files:**
- `AdminLogin.jsx` — defines and exports `adminFetch`. Also re-exports `writeAdminSession`, `getAdminToken`, `clearAdminSession`, `getAdminSession` from `../../auth/adminAuthStore` as a backward-compat shim.
- `AdminLayout.jsx` — auth guard (checks token at render time, no context), 8-item sidebar nav. Support badge polls open tickets every 60s.
- `AdminDashboard.jsx` — loads 8 parallel endpoints on mount. `InfrastructurePanel` polls `GET /api/admin/infra` every 60s, pauses when tab hidden.
- `AdminTenantList.jsx` — search + status filter, create modal, delete modal (requires typing slug to confirm), CSV export via `downloadCsv`.
- `AdminTenantDetail.jsx` — impersonation opens `/context-select?impersonate_token=...` in a new tab. Feature flags toggled via `PUT /api/admin/tenants/:id/feature-flags`. CRM notes CRUD.
- `AdminSupportTickets.jsx` — cross-tenant support viewer, quick-impersonate that redirects to `ticket.page_url`.
- `AdminEmails.jsx` — 5-tab (All/Pending/Sent/Failed/Broadcasts). Stops polling on Broadcasts tab.
- `AdminActivity.jsx` — 3-tab log (Admin Actions, Tenant Activity, Security), offset-based pagination, CSV export.
- `AdminTaxRates.jsx` — **exception**: defines its own local `adminFetch` (does NOT import from `AdminLogin.jsx`). No auto-refresh polling.
- `AdminDeadLetters.jsx` — failed webhook events, "Retry All" loops sequentially.
- `AdminStuckPayments.jsx` — stuck payment intents + recent webhook events (read-only). Threshold selector (1h/2h/6h/24h).

**Polling**: most admin pages auto-refresh every 30s. `AdminLayout` support badge: 60s. `AdminTaxRates`: no polling.

---

### `portal/` — Customer self-service portal

Routes at `/portal/:tenantSlug`. Fully self-contained auth: `PortalAuthProvider` + `../../auth/customerPortalStore`. No main-app `useAuth`, no permissions system, no `ui/primitives`, no `useCurrency`.

**Key facts:**
- All API calls use `portalApi` from `../../api/portalApi` (NOT `api.js`). Attaches portal JWT, appends `?tenant=<slug>`, handles silent 401 refresh (retries once after refresh; clears session on second 401).
- All fetches use `credentials: "include"` for the httpOnly refresh cookie.
- Tab visibility is server-driven: `PortalLayout` fetches `GET /api/portal/config` → `enabled_tabs` array passed via `<Outlet context>`. Never assume a tab is available.
- Currency via `toLocaleString()` (not `useCurrency`). All UI is inline Tailwind.

**Auth pages (public):** `PortalLogin`, `PortalSignup`, `PortalOtpVerify`, `PortalForgotPassword`, `PortalResetPassword`.

**Authenticated pages:** `PortalDashboard` (home, up to 3 conditional fetches based on `enabledTabs`), `PortalInvoices`, `PortalInvoiceDetail`, `PortalInvoicePaidPage` (polls every 1500ms up to 8 attempts for paid status), `PortalAppointments`, `PortalOrders`, `PortalLoyalty`, `PortalProfile`, `PortalTreatments` (two-level drill-down with 6 sections), `PortalStays`, `PortalWallet`.

**Known tab keys:** `invoices`, `orders`, `appointments`, `subscriptions`, `contracts`, `tickets`, `loyalty`, `wallet`, `profile`, `stays`, `treatments`.

---

### `reports/` — Report modules

All report tab components orchestrated by `pages/Reports.jsx`. All use `{ api }` named import from `../../api`.

**Shared utilities (`ReportShared.jsx`):** `fmtDate`, `fmtDateTime`, `exportCSV(filename, cols, rows)`, `ExportButton`, `TableShell`, `DateRangeFilter`, `CardShell`, `MetricCard`.

**Date param convention:** Most tabs use `date_from`/`date_to`. Exceptions that use `from`/`to`: `ReportsMultichannel`, `ReportsCommissions`, `KdsAnalyticsTab`, `MenuEngineeringTab`, `FBRExportTab`. Shift-locked tabs use `session_id` only (skip date params): `ShiftSummaryTab`, `ShiftSalesTab`, `PaymentSummaryTab`, `CashAuditTab`, `CurrentSessionZReportTab`.

**Timestamp gotcha:** `ReportsStaff.jsx` `AttendanceTab` uses `parseLocalDate` (attendance is local time). All other report files use UTC formatters.

**Barrel files (re-exports only):**
- `ReportsSales.jsx` → `OverviewTab`, `SalesSummaryTab`, `MonthlyMOPMatrixTab`, `SubcategoryWiseTab`, `SalesDetailTab`, `OrderWiseTab`, `ItemWiseTab`, `RefundsVoidsTab`, `CashierWiseTab`, `DailyOperationsTab`
- `ReportsInventory.jsx` → `SalesStockTab`, `InventoryDumpTab`, `OnHandTab`, `ProductPerformanceTab`, `BrandWiseTab`, `MerchandisingWorkspaceTab`, `PricingMarginTab`, `DeadStockTab`, `StockAgingTab`, `ShrinkageTab`, `ReplenishmentTab`, `StockoutRiskTab`, `ForecastDemandTab`, `ReplenishmentSmartTab`

**Other modules:** `ReportsFinance.jsx`, `ReportsAnalytics.jsx`, `ReportsAudit.jsx` (uses `api.raw()` for 503 feature-gate detection), `ReportsCatalog.jsx`, `ReportsCustomers.jsx` (RFM scoring is entirely client-side), `ReportsGovernance.jsx` (feature-gated by `reports_scheduled_exports`), `ReportsOperations.jsx`, `ReportsPurchasing.jsx`, `ReportsShifts.jsx`, `ReportsStaff.jsx`, `ReportsMultichannel.jsx`, `ReportsCommissions.jsx` (uses `downloadCsv` + `fmtUtcDateTime` directly, not via `ReportShared`), `ClinicalTab.jsx`, `KdsAnalyticsTab.jsx`, `MenuEngineeringTab.jsx`.

---

## Top-Level Pages

### `*Route.jsx` wrappers — never edit

Every `*Route.jsx` file is a 5-line thin wrapper that lazy-loads the corresponding `*Redesign.jsx`. They exist only to satisfy the route tree. The actual code lives in `redesign/`. Do not edit these files — edits belong in the corresponding `*Redesign.jsx`.

Example pattern:
```js
import XRedesign from './redesign/XRedesign';
export default function XRoute() { return <XRedesign />; }
```

### Public / auth pages

| File | Route | Notes |
|------|-------|-------|
| `LandingPage.jsx` | `/` (unauthenticated) | Competitive positioning, pricing (Free + Pro), login form. Login placeholders: `"e.g. aceshardware"` / `"Enter your password"` / button `"Sign In"`. |
| `LoginPage.jsx` | `/login` | Standalone login (MT mode) |
| `SignupPage.jsx` | `/signup` | Public self-service signup — gated by `SELF_SERVICE_SIGNUP=1` on backend |
| `ResetPassword.jsx` | `/reset-password?token=xxx&tenant=slug` | Public, no auth |
| `VerifyEmail.jsx` | `/verify-email` | Public email verification |
| `ReceiptPublicPage.jsx` | `/receipt/:invoiceNumber` | Public shareable receipt — calls `GET /api/receipts/:invoiceNumber/public?tenant=slug`, no auth |
| `ContextSelect.jsx` | `/context-select` | Post-login context selector (also used by impersonation flow) |
| `AccessDenied.jsx` | `/access-denied` | Permission error page |
| `PlaceholderPage.jsx` | various | Placeholder for unimplemented routes |

### Special pages

| File | Notes |
|------|-------|
| `CustomerDisplayPage.jsx` | Customer-facing display screen (second monitor / tablet) |
| `InvoiceView.jsx` | Invoice viewer — legacy, imported by its Redesign counterpart. Do not delete; do not edit directly. |
| `Reports.jsx` | **NOT legacy** — active reports orchestrator. Delegates to `pages/reports/` modules. Registers all tab configs. Also exports `ReportTabStandalone` consumed by `ReportsTabStandaloneRedesign`. |
| `Accounting.jsx` | Legacy page wrapped by `AccountingRedesign.jsx` — do not delete or edit directly |
| `Attendance.jsx` | Legacy page wrapped by `AttendanceRedesign.jsx` — do not delete or edit directly |

Other legacy pages at this level (do not edit directly, wrapped by their `*Redesign.jsx` counterparts): `Approvals.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx`.

### Landing variants

Alternative visual styles for the landing page — `LandingBazaar.jsx`, `LandingBrutalist.jsx`, `LandingEditorial.jsx`, `LandingLuxury.jsx`, `LandingScrapbook.jsx`, `LandingShowroom.jsx`, `LandingTruckart.jsx`, `LandingY2k.jsx`. `LandingPagePreview.jsx` renders all variants side-by-side for design review. These are not shown to production users by default.

---

## Other Subdirectories

### `dashboard/`

Dashboard widget components. All receive data as props from `DashboardRedesign.jsx` unless noted. Use `SectionCard` from `ui/primitives`. Return `null` when data is empty — no skeleton states.

Key widgets: `DashboardKPICards`, `DashboardTrends` (Recharts BarChart + AreaChart), `DashboardAttendance`, `DashboardOpsReadiness`, `DashboardAttention` (pure frontend rules engine — no API calls), `DashboardExceptions`, `DashboardInventoryAlerts`, `DashboardContribution`, `DashboardOutletRanking`, `DashboardRecentSales`, `DashboardTopProducts`, `DashboardQuickActions`, `DashboardOnboarding` (dual-persistence: localStorage + server), `BackupStatusCard` (admin-only, fetches independently), `InsightCards` (fetches independently, uses `useCurrency()` from `CurrencyContext` directly — NOT from `DashboardShared`), `AIChatPanel` (gated by `ai_insights` flag, returns `null` if falsy).

`DashboardShared.jsx` re-exports `useCurrency` + internal helpers `DeltaArrow` and `RelativeTime`.

### `public/`

Unauthenticated public pages. No `api.js`, no auth headers, raw `fetch()` throughout. Self-contained Tailwind (no `ui/primitives`, no `ToastContext`). All import `API_BASE` from `../../config`.

- `PublicBookingPage.jsx` — `/book/:tenantSlug`, 4-step appointment booking wizard. Local toast auto-dismisses at 2500ms (different from ToastContext's 4000ms).
- `PublicRestaurantMenuPage.jsx` — `/menu/:token`, QR-code digital menu. Items with no `category_id` bucket into `"uncat"` shown as `"Other"`.

### `shopify/`

Shopify integration tab modules, all rendered inside `ShopifyIntegrationRedesign.jsx` (wraps in `<ShopifyProvider>`).

- `ShopifyContext.jsx` — exports `ShopifyProvider` + `useShopify()`. `apiFetch` is `api.raw` wrapped in `useCallback` — callers must check `res.ok` and call `res.json()` manually. `access_token` + `webhook_secret` always returned as empty strings from server.
- `ShopifyOverview.jsx`, `ShopifySettings.jsx`, `ShopifyImport.jsx`, `ShopifyMappings.jsx`, `ShopifyEvents.jsx`, `ShopifyReconciliation.jsx`.

`ShopifyReconciliation.jsx` CSV export uses inline blob (does NOT use `utils/csvExport.js`).

### `storefront/`

Public tenant storefront at `/store/:tenantSlug`. Unauthenticated, no `api.js`, raw `fetch()` throughout. Currency from `config.currency_symbol || "Rs"` (not `useCurrency`). No feature flags, no permissions, self-contained Tailwind.

- `StorefrontLayout.jsx` — root shell, creates `StorefrontContext` + `useStorefront()` hook. Cart badge shows total quantity (sum of `item.quantity`), capped at "99+".
- `useStorefrontCart.js` — token-based anonymous cart. `localStorage` key: `sf_cart_<tenantSlug>`. Uses `tokenRef` (`useRef`) to avoid stale closure in callbacks.
- `StorefrontCart.jsx` — **instantiates its own `useStorefrontCart(tenantSlug)`**, does NOT use `cart` from `StorefrontContext`. Intentional — needs full mutation access.
- `StorefrontCheckout.jsx` — default delivery method is `"pickup"`.
- `StorefrontOrderStatus.jsx` — auto-polls order status every 30s.

---

## Key Conventions

- **Never edit `*Route.jsx` files** — all actual logic lives in `redesign/`.
- **`redesign/` is the primary codebase** — when a user says "fix the customers page", read `redesign/CustomersRedesign.jsx`.
- **Legacy originals** (`Accounting.jsx`, `Approvals.jsx`, `Attendance.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx`, `InvoiceView.jsx`) are imported by their `*Redesign.jsx` wrappers — do not delete or edit these directly unless the task is specifically about the wrapped legacy component.
- **`Reports.jsx` is NOT legacy** — it is the active orchestrator for all report tabs.
- **Admin pages use `adminFetch`**, not `api.js`. Do not replace with `api.js` in admin files.
- **Portal pages use `portalApi`**, not `api.js`. Do not replace with `api.js` in portal files.
- **Public pages** (`public/`, `storefront/`) use raw `fetch()` intentionally — no auth context available.
