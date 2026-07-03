# Route and API contract matrix

This is a coverage-oriented matrix of route families and their client/API contract, not an assertion that every listed page was dynamically exercised.

| Route family | Frontend guard/layout | Primary client/API families | Contract notes |
|---|---|---|---|
| `/`, `/login`, `/signup`, `/reset-password`, `/verify-email`, legal/preview routes | Public route tree; root waits for auth bootstrap | raw/api.raw auth/setup endpoints | Public auth endpoints intentionally suppress account-enumeration errors. Root setup probe is single-tenant only. |
| `/receipt/:invoiceNumber`, `/gift-card/:code`, `/customer-display` | Public, no tenant auth wrapper | public receipt/gift-card/display GETs; tenant query where required | Customer display uses shift+tenant query and polls every 2s; backend public contract confirmed. |
| `/store/:tenantSlug/*`, `/book/:tenantSlug`, `/menu/:token`, `/pay/:token`, `/reserve/:tenantSlug` | Public nested layouts | storefront/public booking/restaurant APIs | Separate public-token/tenant-slug contracts; no tenant `AuthProvider` authorization assumption should be made. |
| `/portal/:tenantSlug/*` | PortalLayout + portal-specific store/API | customer portal auth, invoices, appointments, treatments, stays, orders, wallet/profile | Session key is slug-scoped and independent from tenant/admin auth. |
| `/manufacturer-portal/:tenantSlug/*` | Manufacturer portal layout/store/API | manufacturer setup/login/sales/schemes | Independent JWT/session scope. |
| `/context-select` | `RequireAuth` only | outlets/context persistence | Establishes outlet/company/scope consumed by interceptor. |
| `/pos` | `RequireAuth`, preset+flag redirect inside `POSRoute`; outside app shell/context guard | products/scan, shifts, attendance, sales, returns, parked sales, display, loyalty, offline queue | Backend remains authoritative. Offline tenant isolation defect F-01; keyboard defect F-07. |
| `/pos/restaurant` | `RequireAuth`, preset-mode redirect; no primary feature check | restaurant floors/checks/drafts + shared POS APIs | Flag mismatch F-08. |
| `/kiosk` | `RequireAuth`, page-level error boundary | attendance kiosk APIs | Full-screen route outside app shell. |
| App shell: dashboard/profile/tickets/sales/customers/reports/notifications/tax lookup/receipt templates | pathless `RequireAuth > RequireContext > AppLayoutRedesign`; several routes intentionally open to any employee | domain `api.get/post/put/del`; report raw calls for feature response codes | Backend permission enforcement still required. Receipt upload contract defect F-03. |
| Inventory/catalog: inventory/products/categories/taxes/brands/promotions/transfers/adjustments/reorder/intelligence | app shell + mostly `manage_inventory` | inventory/product/category/tax/promotion APIs | Route permission mapping inspected; uploads use raw `Response` contract. |
| Purchasing/suppliers/orders/approvals/fulfillment/COD | app shell + mostly `manage_orders` | PO/GRN/supplier/order/fulfillment APIs | Export/download paths correctly use `api.raw` and check `res.ok` in sampled callers. |
| Admin settings: employees/outlets/company/import/backup/billing/FBR/integrations | app shell + `all_access` or explicit domain permission | employee/outlet/profile/import/backup/billing/integration APIs | Import/backup/logo callers sampled; most explicitly parse/check raw upload responses. |
| Restaurant/KDS routes under app shell | `manage_restaurant`, `manage_kds`, `manage_tips` route wrappers; feature checks mainly inside pages/backend | `/api/restaurant/*`, `/api/kds/*`, `/api/tips/*` | Direct full-screen restaurant POS differs; see F-08. |
| Appointments/projects/contracts/service/rentals/rooms/treatment plans | explicit domain permissions; feature flags predominantly page/backend-owned | corresponding CRUD/workflow APIs | Clinical document upload false-success F-04. |
| `/field/*` | app shell + `manage_field_sales`; inline `wholesale_field_sales` checks | field route/check-in/visits, products/customers, sales | Offline row routing/retry is broken (F-02). |
| `/admin/*` | admin login outside; `AdminLayout` owns admin token check | `adminFetch`, not tenant API/interceptor | Separate super-admin session store. |

Shared client contracts:

- `api.get/post/put/del` parse JSON and throw an `Error` carrying `status` and `body` on non-OK (`src/api.js:18-63`).
- `api.upload` and `api.raw` return raw `Response` and never throw merely for HTTP status (`src/api.js:65-72`). Every caller must check `res.ok` and parse explicitly.
- The tenant fetch interceptor injects employee/JWT/context headers and credentials, synthesizes offline-write 503 responses, refreshes expired access tokens, tracks request IDs and notices subscription expiry (`AuthProvider.jsx:313-438`).
- `api.upload` call-site audit: SupportWidget, BackupRestore, CompanySettings, Import, ImportFromCompetitor, ProductForm parse/check responses; ReceiptTemplates misparses (F-03); TreatmentPlans ignores status (F-04).

## Production enablement and runtime-verification overlay

“Production-enabled” below means the route is compiled/mounted for the production build. It does not imply that a tenant feature flag, plan, permission, mode, or external integration is enabled. “Runtime verified” is deliberately narrow: no authenticated production browser workflow was executed by this audit.

| Route family | Production-enabled | Runtime verified in this audit | Evidence / limitation |
|---|---|---|---|
| Public marketing/auth/legal (`/`, `/login`, `/signup`, reset/verify, previews, legal) | Yes; signup remains server/env gated | No browser workflow | Present in `publicRoutes.jsx`; production build passed. Public API deep health does not verify these UI flows. |
| Public receipt/gift-card/customer display | Yes | No | Routes and frontend/backend contracts reviewed statically; no live receipt, gift card, or shift identifier queried. |
| Storefront and public booking/menu/pay/reserve | Conditional by tenant data, flags, and token | No | Route tree compiled; no public token or tenant storefront exercised. |
| Customer portal | Conditional by tenant/customer portal configuration | No | Nested route tree compiled; separate portal auth/client inventoried, no live portal session used. |
| Manufacturer portal | Conditional by feature/configuration | No | Nested route tree compiled; separate manufacturer auth/client inventoried, no live session used. |
| Context selector and protected app shell | Yes after tenant authentication; individual pages permission/flag gated | No authenticated browser workflow | Guard composition and routes reviewed; root typecheck/build/unit checks passed, but those are not route runtime verification. |
| Retail POS (`/pos`) | Yes for authenticated tenants; checkout depends on context/shift/attendance and backend permissions | No live sale | POS source/unit coverage reviewed; production mutations explicitly avoided. |
| Restaurant POS (`/pos/restaurant`) | Conditional on restaurant mode and feature entitlement | No | Static gate mismatch recorded as F-08; no restaurant tenant session used. |
| Attendance kiosk (`/kiosk`) | Yes for authenticated tenant session | No | Compiled route only; no kiosk PIN/attendance mutation performed. |
| Inventory/catalog/purchasing/order/admin settings | Yes, permission/plan/feature dependent | No | Compiled and statically inventoried. Root production build passed; no CRUD operation performed. |
| Reports/accounting/analytics | Conditional by permission, feature and data | No | Routes/API calls inventoried; no report response or export downloaded. |
| Restaurant/KDS/tips app-shell routes | Conditional by restaurant mode and feature flags | No | Route/backend gates inventoried; no runtime flag state verified. |
| Appointments/projects/contracts/service/rentals/rooms/treatment plans | Conditional by mode/feature/permission | No | Routes compiled; selected treatment upload contract reviewed, no live workflow. |
| Field-sales routes | Conditional on `wholesale_field_sales` and `manage_field_sales` | No | Offline source flow reviewed and F-02 confirmed statically; no GPS/selfie/order production mutation. |
| Super-admin (`/admin/*`) | Yes, requires separate admin session | No | Admin route tree compiled/inventoried; no admin login or production mutation performed. |
| PWA service worker/install surface | Registration production-enabled when `IS_PROD` | No browser install/offline runtime | `main.jsx`, manifest and `sw.js` reviewed statically; no production service-worker state changed. |

Cross-checks that did run but are not route runtime verification: frontend production build passed (3,279 modules), typecheck passed, unit suite passed 155/155 with React `act(...)` warnings, and full lint failed with 944 problems. See `.audit/command-ledger.md`.
