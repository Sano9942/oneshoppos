# SanoPOS Frontend — File Audit

*Last audited: March 15 2026. Production on Vercel, VITE_MULTI_TENANT=1.*

---

## Summary

The frontend is a React 19 + Vite 7 + Tailwind CSS v4 SPA. **All 170 files are actively used — zero dead code found.** The codebase follows a consistent architecture: Route wrappers → Redesign pages → shared primitives. Reports, Shopify, Dashboard, and POS are each modularized into subfolders.

The main improvement opportunities are **large files that could be split** and a handful of code quality issues.

---

## FILE INVENTORY (170 files, all active)

### Core Entry Points (5 files)

| File | Lines | Purpose |
|------|-------|---------|
| `App.jsx` | 585 | Route orchestrator (60+ routes, admin, POS, auth guards) |
| `main.jsx` | 22 | React entry point (CurrencyProvider → AuthProvider → App) |
| `config.js` | 8 | API_BASE, IS_MULTI_TENANT flag |
| `App.css` | — | App-level styles |
| `index.css` | — | Global Tailwind directives + CSS tokens |

### Auth & Session (2 files)

| File | Lines | Purpose |
|------|-------|---------|
| `auth/AuthProvider.jsx` | 348 | Global fetch interceptor, JWT refresh, Bearer token injection, header propagation |
| `auth/authStore.js` | 71 | Token storage helpers (readToken, writeToken, readTenantSlug, readSession, readContext) |

### UI System (3 files)

| File | Lines | Purpose |
|------|-------|---------|
| `ui/primitives.jsx` | 122 | Design-system components (PageShell, SectionCard, Button, Input, etc.) |
| `ui/nav-config.js` | 124 | Sidebar navigation menu configuration |
| `ui/tokens.css` | 28 | CSS design tokens (colors, spacing, shadows) |

### Contexts (1 file)

| File | Lines | Purpose |
|------|-------|---------|
| `contexts/CurrencyContext.jsx` | 60 | Currency provider — wraps OUTSIDE AuthProvider for unauthenticated pages |

### Hooks (2 files)

| File | Lines | Purpose |
|------|-------|---------|
| `hooks/useFeatureFlags.js` | 62 | Fetch and cache feature flags |
| `hooks/useReportFilters.js` | 22 | Report filter state management |

### Utils (4 files)

| File | Lines | Purpose |
|------|-------|---------|
| `utils/dates.js` | 76 | Timezone-aware formatters (fmtUtcDateTime, fmtLocalDateTime, etc.) — 32 imports |
| `utils/receipt.js` | 222 | Receipt rendering (buildReceiptSections, buildReceiptHtml, printToHardware) |
| `utils/categoryTree.js` | 28 | Category tree helpers (flatten, render hierarchies) |
| `utils/offlineQueue.js` | 36 | Offline sale queue (localStorage, max 50 sales) |

### Components (6 files)

| File | Lines | Purpose |
|------|-------|---------|
| `components/AppLayoutRedesign.jsx` | 134 | Main layout wrapper (sidebar, header, notifications) |
| `components/ContextSwitcher.jsx` | 123 | Branch/outlet selector dropdown |
| `components/NotificationBell.jsx` | 165 | Notification icon with popover |
| `components/RequireAuth.jsx` | 21 | Auth guard — redirects to /login |
| `components/RequireContext.jsx` | 35 | Context guard — redirects to /context-select |
| `components/RequirePerm.jsx` | 19 | Permission guard — shows access denied |

### Route Wrapper Files (31 files in `pages/`)

All are 5-line thin wrappers that import and render the redesign counterpart. Pattern: `AccountingRoute.jsx` → `AccountingRedesign.jsx`. **All active — imported by App.jsx.**

Files: `AccountingRoute`, `ActionHistoryRoute`, `AdministratorRoute`, `AttributeSetsRoute`, `BackupRestoreRoute`, `BrandsRoute`, `CRMRoute`, `CashManagementRoute`, `CategoriesRoute`, `CompanySettingsRoute`, `CustomersRoute`, `DashboardRoute`, `EmployeesRoute`, `ExpensesRoute`, `HRManagementRoute`, `InventoryRoute`, `OrdersRoute`, `OutletsRoute`, `POSRoute`, `PromotionsRoute`, `PurchaseOrdersRoute`, `QuotationsRoute`, `ReturnedStockRoute`, `ReturnsRoute`, `SalesHistoryRoute`, `ShopifyIntegrationRoute`, `StockAdjustmentsRoute`, `SupplierPayablesRoute`, `SuppliersRoute`, `TaxesRoute`, `TransfersRoute`

### Legacy Original Pages (8 files in `pages/`)

Imported by their Redesign wrappers. **Do NOT delete — they contain active business logic.**

| File | Lines | Imported By |
|------|-------|-------------|
| `Accounting.jsx` | 640 | AccountingRedesign.jsx |
| `Approvals.jsx` | 269 | ApprovalsRedesign.jsx |
| `Attendance.jsx` | 417 | AttendanceRedesign.jsx |
| `BarcodeTemplates.jsx` | 524 | BarcodeTemplatesRedesign.jsx |
| `ReceiptTemplates.jsx` | 366 | ReceiptTemplatesRedesign.jsx |
| `ShopifyIntegration.jsx` | 131 | ShopifyIntegrationRedesign.jsx |
| `InvoiceView.jsx` | 419 | SalesHistoryRedesign.jsx |
| `Reports.jsx` | 909 | ReportsRedesign.jsx + lazy import in App.jsx |

### Public/Entry Pages (6 files in `pages/`)

| File | Lines | Purpose |
|------|-------|---------|
| `Login.jsx` | 123 | Login page (unauthenticated) |
| `ContextSelect.jsx` | 279 | Branch/outlet selector post-login |
| `AccessDenied.jsx` | 28 | 403 page |
| `CustomerDisplayPage.jsx` | 195 | Customer-facing display (dark, no auth) |
| `SetupWizard.jsx` | 493 | First-run wizard (unauthenticated, token-gated) |
| `PlaceholderPage.jsx` | 45 | Placeholder for future features |

### Active Redesign Pages (44 files in `pages/redesign/`)

All actively rendered. Highlights by size:

| File | Lines | Notes |
|------|-------|-------|
| `PurchaseOrdersRedesign.jsx` | 1308 | Largest — PO CRUD + approval flow |
| `InventoryRedesign.jsx` | 1092 | Product CRUD + stock management |
| `PromotionsRedesign.jsx` | 776 | Promotion builder |
| `SupplierPayablesRedesign.jsx` | 752 | AP dashboard |
| `OrdersRedesign.jsx` | 678 | Order detail tabs |
| `HRManagementRedesign.jsx` | 666 | HR + leave management |
| `ExpensesRedesign.jsx` | 617 | Expense tracking |
| `CustomersRedesign.jsx` | 592 | Customer + loyalty/wallet |
| `CategoriesRedesign.jsx` | 585 | Tree-based category manager |
| `ProductFormPage.jsx` | 580 | Full-page product form |
| *+ 34 smaller files* | <530 | All active |

### POS Submodules (17 files in `pages/redesign/pos/`)

All orchestrated by `POSRedesign.jsx`.

| File | Lines | Purpose |
|------|-------|---------|
| `POSContext.jsx` | 1219 | POS state manager (128+ exports) |
| `POSReturnExchangeModal.jsx` | 594 | Return/exchange flow |
| `POSCheckoutModal.jsx` | 522 | Checkout flow |
| `POSOpeningGateModal.jsx` | 221 | Opening shift gate |
| `POSReceiptModal.jsx` | 201 | Receipt preview/print |
| `POSSidebar.jsx` | 189 | Sidebar navigation |
| `POSCloseShiftModal.jsx` | 193 | Shift close workflow |
| `POSRecentSalesPanel.jsx` | 156 | Recent sales list |
| `POSCartTable.jsx` | 111 | Cart display |
| `POSHeader.jsx` | 111 | Header with date/time |
| `POSSearchArea.jsx` | 107 | Product search |
| `POSSessionExpiredModal.jsx` | 102 | Session recovery |
| `POSEmailReceiptModal.jsx` | 95 | Email receipt sender |
| `POSParkedModal.jsx` | 91 | Parked sales dialog |
| `POSSubHeader.jsx` | 76 | Subheader info |
| `POSDiscountModal.jsx` | 65 | Discount application |
| `POSLockScreen.jsx` | 65 | Security lock |
| `POSNoteModal.jsx` | 40 | Add order note |

### Dashboard Modules (14 files in `pages/dashboard/`)

All orchestrated by `DashboardRedesign.jsx`.

| File | Lines | Purpose |
|------|-------|---------|
| `DashboardKPICards.jsx` | 164 | Revenue, sales count, avg bill KPIs |
| `DashboardOnboarding.jsx` | 145 | 5-step onboarding checklist |
| `DashboardAttention.jsx` | 118 | Tenants needing attention (admin view) |
| `DashboardOpsReadiness.jsx` | 115 | Staffing, shift, attendance readiness |
| `DashboardTrends.jsx` | 87 | Daily trend chart |
| `DashboardInventoryAlerts.jsx` | 69 | Low stock alerts |
| `DashboardContribution.jsx` | 64 | Contribution breakdown |
| `DashboardRecentSales.jsx` | 63 | Recent sales list |
| `DashboardAttendance.jsx` | 57 | Today's attendance summary |
| `DashboardExceptions.jsx` | 55 | Alert exceptions |
| `DashboardOutletRanking.jsx` | 48 | Outlet ranking chart |
| `DashboardTopProducts.jsx` | 45 | Top 5 products |
| `DashboardQuickActions.jsx` | 40 | Quick action buttons |
| `DashboardShared.jsx` | 29 | Shared utilities |

### Report Modules (12 files in `pages/reports/`)

All orchestrated by `Reports.jsx`.

| File | Lines | Purpose |
|------|-------|---------|
| `ReportsInventory.jsx` | 2721 | Inventory dump, movement, shrinkage |
| `ReportsSales.jsx` | 1804 | Sales detail, summary, item-wise |
| `ReportsFinance.jsx` | 993 | P&L, cash flow, tax reports |
| `ReportsPurchasing.jsx` | 929 | Total purchases, procurement |
| `ReportsShifts.jsx` | 820 | Shift summaries, cash drawer |
| `ReportsCatalog.jsx` | 754 | Catalog/SKU management |
| `ReportsCustomers.jsx` | 702 | Customer analysis |
| `ReportsGovernance.jsx` | 506 | Report schedules, saved views |
| `ReportsAnalytics.jsx` | 584 | Comparative trends, heatmaps |
| `ReportsOperations.jsx` | 462 | Operational metrics |
| `ReportsAudit.jsx` | 385 | Action history, audit logs |
| `ReportsStaff.jsx` | 315 | Labor performance, loss prevention |
| `ReportShared.jsx` | 194 | Shared utilities (export, charts) |

### Shopify Modules (7 files in `pages/shopify/`)

All orchestrated by `ShopifyIntegration.jsx`.

| File | Lines | Purpose |
|------|-------|---------|
| `ShopifyReconciliation.jsx` | 391 | Order/inventory reconciliation |
| `ShopifyMappings.jsx` | 356 | Field mapping configuration |
| `ShopifySettings.jsx` | 330 | API key, connection settings |
| `ShopifyEvents.jsx` | 206 | Webhook event history |
| `ShopifyImport.jsx` | 201 | Product/inventory import |
| `ShopifyContext.jsx` | 137 | Shopify state/config context |
| `ShopifyOverview.jsx` | 127 | Connection status dashboard |

### Admin Pages (5 files in `pages/admin/`)

Separate from POS auth — uses `adminFetch` and `localStorage["adminSession"]`.

| File | Lines | Purpose |
|------|-------|---------|
| `AdminTenantDetail.jsx` | 449 | Tenant details, edit, usage stats |
| `AdminTenantList.jsx` | 318 | Searchable tenant list + provisioning |
| `AdminDashboard.jsx` | 210 | Super-admin stats, tenant health |
| `AdminLogin.jsx` | 134 | Super-admin login (separate session) |
| `AdminLayout.jsx` | 80 | Admin layout wrapper with sidebar |

---

## SECURITY & CODE QUALITY FINDINGS (Mar 15 2026)

Full code review performed. **Zero XSS vulnerabilities, zero auth bypass issues, zero sensitive data leaks.** Route guards properly implemented across all protected routes.

### Issues Found

| # | Severity | Issue | File | Details |
|---|----------|-------|------|---------|
| 1 | **MEDIUM** | Manual `x-employee-id` from localStorage | `redesign/PrinterSettingsRedesign.jsx` | 7 fetch calls use `localStorage.getItem("employeeId") \|\| "1"` instead of relying on the global fetch interceptor. The interceptor already injects this header — these manual headers are redundant and the `"1"` fallback could target wrong employee. Fix: remove manual headers; interceptor handles it. |
| 2 | **LOW** | Silent error handling in report tabs | `pages/reports/*.jsx` | Most report fetch calls catch errors silently (`catch { setRows([]) }`). Users see blank table with no feedback. Could add toast/error UI. |
| 3 | **LOW** | Missing `!res.ok` checks | Various report files | Some fetch calls don't check response status before parsing JSON. Non-200 responses parsed as data. |
| 4 | **LOW** | Admin token in localStorage | `pages/admin/AdminLogin.jsx` | Admin JWT stored in localStorage (readable by JS). Acceptable for internal admin panel — mitigated by backend IP allowlisting (`ADMIN_ALLOWED_IPS`). |

### Confirmed Secure (no action needed)

- **XSS**: Zero unsafe HTML rendering anywhere in the codebase
- **Auth headers**: Global fetch interceptor (`AuthProvider.jsx`) injects `x-employee-id`, `x-outlet-id`, `x-scope-mode`, and `Bearer` token on ALL `/api/` calls automatically — report files do NOT need manual auth headers
- **Route guards**: `RequireAuth`, `RequireContext`, `RequirePerm` properly applied to all protected routes
- **Public routes**: `/customer-display`, `/setup`, `/admin/login` correctly unguarded
- **Token refresh**: Silent refresh on 401 with `TOKEN_EXPIRED` works correctly via `_nativeFetch`
- **Dependencies**: React 19, Vite 7, Tailwind v4, Recharts 3.7 — all current, no known CVEs
- **Service worker**: `sw.js` exists in `public/`, registration in `main.jsx` is correct

### Large Files (candidates for future splitting — not urgent)

| File | Lines | Potential Split |
|------|-------|-----------------|
| `ReportsInventory.jsx` | 2721 | Split by tab: dump, movement, shrinkage |
| `ReportsSales.jsx` | 1804 | Split by tab: summary, detail, item-wise |
| `PurchaseOrdersRedesign.jsx` | 1308 | Extract modal components |
| `POSContext.jsx` | 1219 | Extract cart/shift/receipt sub-contexts |
| `InventoryRedesign.jsx` | 1092 | Extract tabs to separate files |

---

## TEST COVERAGE

| Location | Type | Count | Status |
|----------|------|-------|--------|
| `tests/live/` (00–19) | Playwright E2E vs production | ~120 tests | All passing (Mar 14 2026) |
| `tests/unit/` | Component unit tests | Various | Passing |
| `tests/e2e/` | Playwright E2E vs dev | Various | Passing |

---

## ARCHITECTURE NOTES

- **No dead code** — all 170 files are actively imported and used
- **No duplicate functionality** — each concern has a single canonical file
- **Route indirection**: 31 `*Route.jsx` files are thin wrappers (5 lines each). Mechanical but functional — keeps App.jsx route definitions clean
- **Legacy wrappers**: 8 original pages preserved and imported by redesign wrappers. Pragmatic — keeps tested business logic intact
- **Design system**: `primitives.jsx` is the single source of truth. All redesign pages use `PageShell`, `SectionCard`, etc.
- **Global fetch interceptor**: `AuthProvider.jsx` patches `window.fetch` — all `/api/` calls get auth headers automatically. No need for manual header injection in components.

---

## Production State Reference (Mar 15 2026)

| Item | Value |
|------|-------|
| Hosting | Vercel (root dir: `frontend`) |
| URL | `https://sanopos.vercel.app` |
| Admin URL | `https://sanopos.vercel.app/admin` |
| MT Mode | `VITE_MULTI_TENANT=1` |
| Build | Vite 7, React 19, Tailwind v4 |
| Security Status | Zero critical vulnerabilities, 1 MEDIUM issue, 3 LOW items |
