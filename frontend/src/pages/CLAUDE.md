# Pages — Claude Guide

`pages/` contains all UI pages. Most active tenant UI lives in `redesign/`. Subdirectories each have their own CLAUDE.md with full detail.

---

## Subdirectory Modules

### `redesign/` — Primary tenant UI

Most active tenant pages are `*Redesign.jsx` files here — see `redesign/CLAUDE.md` for the full domain breakdown (POS, inventory, finance, HR, restaurant, wholesale/B2B, compliance, etc). Route wrappers in `pages/*Route.jsx` are the thin pass-throughs; the real implementations live here.

### `admin/` — Super-admin panel

Routes at `/admin/*`. Separate auth system — uses `adminFetch` from `AdminLogin.jsx` (NOT `api.js`). Session in `localStorage["adminSession"]`. Dark violet/slate-900 theme, no permissions system, no `ui/primitives`, no `useCurrency`.

**Key files:**
- `AdminLogin.jsx` — defines and exports `adminFetch`. Re-exports session helpers from `../../auth/adminAuthStore` as a backward-compat shim.
- `AdminLayout.jsx` — auth guard (checks token at render time), 8-item sidebar nav. Support badge polls open tickets every 60s.
- `AdminDashboard.jsx` — loads 8 parallel endpoints on mount. `InfrastructurePanel` polls `GET /api/admin/infra` every 60s, pauses when tab hidden.
- `AdminTenantList.jsx` — search + status filter, create/delete modals, CSV export.
- `AdminTenantDetail.jsx` — impersonation opens `/context-select?impersonate_token=...` in a new tab. Feature flags, billing, CRM notes.
- `AdminSupportTickets.jsx`, `AdminEmails.jsx` (5 tabs incl. Broadcasts), `AdminActivity.jsx` (3-tab log, offset pagination), `AdminDeadLetters.jsx`, `AdminStuckPayments.jsx`.
- `AdminTaxRates.jsx` — **exception**: defines its own local `adminFetch`, does not import the shared one.

Most admin pages auto-refresh every 30s.

### `portal/` — Customer self-service portal

Routes at `/portal/:tenantSlug`. Fully self-contained auth: `PortalAuthProvider` + `../../auth/customerPortalStore`. No main-app `useAuth`, no permissions system, no `ui/primitives`, no `useCurrency`.

All API calls use `portalApi` from `../../api/portalApi` (NOT `api.js`) — attaches portal JWT, appends `?tenant=<slug>`, silent 401 refresh. Tab visibility is server-driven via `GET /api/portal/config` → `enabled_tabs`.

**Auth pages (public):** `PortalLogin`, `PortalSignup`, `PortalOtpVerify`, `PortalForgotPassword`, `PortalResetPassword`.

**Authenticated pages:** `PortalDashboard`, `PortalInvoices`, `PortalInvoiceDetail`, `PortalInvoicePaidPage` (polls for paid status), `PortalAppointments`, `PortalOrders`, `PortalLoyalty`, `PortalProfile`, `PortalTreatments` (clinical drill-down), `PortalStays`, `PortalWallet`.

### `reports/` — Report modules

All report tab components orchestrated by `pages/Reports.jsx`. All use `{ api }` named import from `../../api`.

**Shared utilities (`ReportShared.jsx`):** `fmtDate`, `fmtDateTime`, `exportCSV(filename, cols, rows)`, `ExportButton`, `TableShell`, `DateRangeFilter`, `CardShell`, `MetricCard`.

**Date param convention:** Most tabs use `date_from`/`date_to`. Exceptions using `from`/`to`: `ReportsMultichannel`, `ReportsCommissions`, `KdsAnalyticsTab`, `MenuEngineeringTab`, `FBRExportTab`. Shift-locked tabs use `session_id` only: `ShiftSummaryTab`, `ShiftSalesTab`, `PaymentSummaryTab`, `CashAuditTab`, `CurrentSessionZReportTab`. `ARAgingTab` is a point-in-time snapshot keyed by `as_of`.

**Barrel files (re-exports only, add new tabs to the underlying file then re-export):**
- `ReportsSales.jsx` → `OverviewTab`, `SalesSummaryTab`, `MonthlyMOPMatrixTab`, `SubcategoryWiseTab`, `SalesDetailTab`, `OrderWiseTab`, `ItemWiseTab`, `RefundsVoidsTab`, `CashierWiseTab`, `DailyOperationsTab`
- `ReportsInventory.jsx` → `SalesStockTab`, `InventoryDumpTab`, `OnHandTab`, `ProductPerformanceTab`, `BrandWiseTab`, `MerchandisingWorkspaceTab`, `PricingMarginTab`, `DeadStockTab`, `StockAgingTab`, `ShrinkageTab`, `ReplenishmentTab`, `StockoutRiskTab`, `ForecastDemandTab`, `ReplenishmentSmartTab`

**Other modules:** `ReportsFinance.jsx`, `ReportsAnalytics.jsx`, `ReportsAudit.jsx` (uses `api.raw()` for 503 feature-gate detection), `ReportsCatalog.jsx`, `ReportsCustomers.jsx` (RFM scoring client-side), `ReportsGovernance.jsx` (gated by `reports_scheduled_exports`), `ReportsOperations.jsx`, `ReportsPurchasing.jsx`, `ReportsShifts.jsx`, `ReportsStaff.jsx` (`AttendanceTab` uses `parseLocalDate`), `ReportsMultichannel.jsx`, `ReportsCommissions.jsx`, `ClinicalTab.jsx`, `KdsAnalyticsTab.jsx`, `MenuEngineeringTab.jsx`.

---

## Top-Level Pages

### `*Route.jsx` wrappers — rarely edit

Most `*Route.jsx` files are thin wrappers that lazy-load the corresponding `*Redesign.jsx`. Do not edit these — edits belong in the `*Redesign.jsx`. Exceptions carrying real logic: `POSRoute.jsx`, `ReportsRoute.jsx`.

```js
import XRedesign from './redesign/XRedesign';
export default function XRoute() { return <XRedesign />; }
```

### Public / auth pages

| File | Route | Notes |
|------|-------|-------|
| `LandingPage.jsx` | `/` (unauthenticated) | Competitive positioning, pricing, login form |
| `LoginPage.jsx` | `/login` | Standalone login (MT mode) |
| `SignupPage.jsx` | `/signup` | Public self-service signup — gated by `SELF_SERVICE_SIGNUP=1` |
| `ResetPassword.jsx` | `/reset-password?token=xxx&tenant=slug` | Public, no auth |
| `VerifyEmail.jsx` | `/verify-email` | Public email verification |
| `ReceiptPublicPage.jsx` | `/receipt/:invoiceNumber` | Public shareable receipt, no auth |
| `ContextSelect.jsx` | `/context-select` | Post-login context selector (also used by impersonation flow) |
| `AccessDenied.jsx` | `/access-denied` | Permission error page |
| `PlaceholderPage.jsx` | various | Placeholder for unimplemented routes |

### Special / legacy pages

| File | Notes |
|------|-------|
| `CustomerDisplayPage.jsx` | Customer-facing display screen (second monitor / tablet) |
| `InvoiceView.jsx` | Legacy, imported by its Redesign counterpart — do not edit directly |
| `Reports.jsx` | **NOT legacy** — active reports orchestrator, delegates to `pages/reports/` modules, exports `ReportTabStandalone` |
| `Accounting.jsx`, `Attendance.jsx`, `Approvals.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx` | Legacy, wrapped by their `*Redesign.jsx` counterparts — do not edit directly |

### Landing variants

Alternative visual styles for the landing page: `LandingBazaar.jsx`, `LandingBrutalist.jsx`, `LandingEditorial.jsx`, `LandingLuxury.jsx`, `LandingScrapbook.jsx`, `LandingShowroom.jsx`, `LandingTruckart.jsx`, `LandingY2k.jsx`, plus `LandingPagePreview.jsx` (side-by-side review). Not shown to production users by default.

### Vertical/workflow route files

`AppointmentsRoute.jsx`, `AppointmentsCalendarRoute.jsx`, `AppointmentServicesRoute.jsx`, `RentalsRoute.jsx`, `RoomManagementRoute.jsx`, `TreatmentPlansRoute.jsx`, `ServiceTicketsRoute.jsx`, `ProjectsRoute.jsx`, `ContractsRoute.jsx`, `SubscriptionsRoute.jsx`, `CommissionPlansRoute.jsx`, `ManufacturerPartnersRoute.jsx` and similar — all thin pass-throughs to their `redesign/` counterpart.

---

## Other Subdirectories

### `dashboard/`

Dashboard widget components, all receive data as props from `DashboardRedesign.jsx` unless noted. Use `SectionCard` from `ui/primitives`. Return `null` when data is empty — no skeleton states.

Key widgets: `DashboardKPICards`, `DashboardTrends` (Recharts), `DashboardAttendance`, `DashboardOpsReadiness`, `DashboardAttention` (pure frontend rules engine), `DashboardExceptions`, `DashboardInventoryAlerts`, `DashboardContribution`, `DashboardOutletRanking`, `DashboardRecentSales`, `DashboardTopProducts`, `DashboardQuickActions`, `DashboardOnboarding`, `BackupStatusCard` (admin-only), `InsightCards` (fetches independently), `AIChatPanel` (gated by `ai_insights` flag).

### `public/`

Unauthenticated public pages. No `api.js`, no auth headers, raw `fetch()` throughout, self-contained Tailwind.

- `PublicBookingPage.jsx` — `/book/:tenantSlug`, 4-step appointment booking wizard.
- `PublicRestaurantMenuPage.jsx` — `/menu/:token`, QR-code digital menu.

### `shopify/`

Shopify integration tab modules, all rendered inside `ShopifyIntegrationRedesign.jsx` (wraps in `<ShopifyProvider>`). `ShopifyContext.jsx` exports `useShopify()` — `apiFetch` is `api.raw` wrapped in `useCallback`, caller must check `res.ok` manually.

### `storefront/`

Public tenant storefront at `/store/:tenantSlug`. Unauthenticated, raw `fetch()` throughout. Currency from `config.currency_symbol || "Rs"` (not `useCurrency`). Token-based anonymous cart (`useStorefrontCart.js`, `localStorage` key `sf_cart_<tenantSlug>`).

---

## Key Conventions

- **Never edit `*Route.jsx` files** (except `POSRoute.jsx`/`ReportsRoute.jsx`) — all actual logic lives in `redesign/`.
- **`redesign/` is the primary codebase** — when asked to fix a page, read the matching `redesign/*Redesign.jsx` file.
- **Legacy originals** (`Accounting.jsx`, `Approvals.jsx`, `Attendance.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx`, `InvoiceView.jsx`) are imported by their `*Redesign.jsx` wrappers — do not delete or edit unless the task is specifically about the wrapped legacy component.
- **Admin pages use `adminFetch`**, portal pages use `portalApi` — never replace either with `api.js`.
- **Public pages** (`public/`, `storefront/`) use raw `fetch()` intentionally — no auth context available.
- Feature flag / currency / timestamp / CSV export conventions match the frontend-wide rules documented in `frontend/src/CLAUDE.md` and `redesign/CLAUDE.md`.
