# pages — Claude Guide

`pages/` holds every UI page in the app. Most active tenant UI lives in `redesign/` — see `redesign/CLAUDE.md` for the full domain breakdown. This file orients the directory as a whole: the thin-wrapper route convention, each subdirectory (several of which have their own deeper `CLAUDE.md`), and the public/no-auth entry points.

---

## The `*Route.jsx` thin-wrapper convention

Most top-level `pages/*Route.jsx` files are **not** real page implementations — they are lazy-load pass-throughs that the route files (`src/routes/*.jsx`) import. The typical shape:

```jsx
import XRedesign from './redesign/XRedesign';
export default function XRoute() { return <XRedesign />; }
```

**Never edit a `*Route.jsx` file** — all real logic belongs in the matching `redesign/*Redesign.jsx`. The two documented exceptions that carry real logic of their own: `POSRoute.jsx` and `ReportsRoute.jsx` (the latter also exports the named `ReportTabStandaloneRoute` consumed by report deep-link routes).

---

## Subdirectories with their own `CLAUDE.md` — read before working inside

### `redesign/` — primary tenant UI
`*Redesign.jsx` files — the actual implementations behind almost every `*Route.jsx` wrapper. POS lives in its own `redesign/pos/` sub-module; `redesign/field/` (wholesale field-rep PWA) and `redesign/treatment/` (clinical treatment-plan sub-pages) are further nested sub-modules. See `redesign/CLAUDE.md`.

### `admin/` — super-admin panel
Routes at `/admin/*`. Entirely separate auth system: Bearer token in `localStorage["adminSession"]` via `auth/adminAuthStore.js`, fetched through `adminFetch` (defined in `AdminLogin.jsx`) — never `api.js`. No tenant permissions system, no `ui/primitives` (styled with the same `--ui-*` Square tokens as the rest of the app, not a separate theme), no `useCurrency`. `adminFetch` silently refreshes on a `401`/`TOKEN_EXPIRED` via the httpOnly refresh cookie and retries once. TOTP 2FA layers on top of password login. Covers: dashboard (with an infra-monitoring panel and a grouped worker-status panel), tenant list/detail (including feature-flag/mode editing, preset-drift detection, impersonation), support tickets, email queue + broadcasts, dead-letter queues (Shopify/aggregator/channel-sync/FBR health), activity + security + impersonation logs, adoption matrix, billing overview, super-admin's own 2FA/session security, tax rate reference CRUD, stuck payment-intent diagnostics, and business-module platform locks. See `admin/CLAUDE.md`.

### `portal/` — customer self-service portal
Routes at `/portal/:tenantSlug`. Fully self-contained: its own auth (`PortalAuthProvider` + `auth/customerPortalStore.js`, slug-scoped sessions) and its own API client (`api/portalApi.js`, not `api.js`) — never the main-app `useAuth()`. Tab visibility is server-driven via `GET /api/portal/config`. Covers auth pages (login/signup/OTP verify/forgot/reset) and every authenticated tab (dashboard, invoices + pay-now, appointments, orders + reorder/backorders, loyalty, profile, treatments, stays, wallet, forms, packages, gallery, contracts, subscriptions, tickets). See `portal/CLAUDE.md`.

### `reports/` — report tab components
Orchestrated by `pages/Reports.jsx` (not legacy — the active reports entry point). All use the `{ api }` named import from `api.js`. Split into barrel modules by domain (Sales, Inventory, Finance, Analytics, Audit, Catalog, Customers, Governance, Operations, Purchasing, Shifts, Staff, Multichannel, Commissions) plus several standalone files (`ClinicalTab`, `KdsAnalyticsTab`, `MenuEngineeringTab`, `FBRExportTab`, `ARAgingTab`). Most tabs use `date_from`/`date_to` params — a handful (`ReportsMultichannel`, `ReportsCommissions`, `KdsAnalyticsTab`, `MenuEngineeringTab`, `FBRExportTab`) use `from`/`to` instead; shift-locked tabs use `session_id` only. See `reports/CLAUDE.md` before adding or touching any tab — the date-param convention is the most common copy-paste bug in this directory.

---

## Other subdirectories (no dedicated `CLAUDE.md` — summarized here)

### `dashboard/`
Widget components rendered by `DashboardRedesign.jsx`, most receiving pre-fetched data as props rather than fetching their own. Built from `ui/primitives` (`SectionCard`) and `--ui-*` tokens; a card returns `null` on empty data rather than rendering a skeleton or error state. Files: `DashboardKPICards` (primary + secondary KPI tiles with a same-metric-vs-yesterday delta arrow, colored via `--ui-success-fg`/`--ui-danger-fg`, `invert` flag for metrics where a decrease is the good direction), `DashboardTrends`, `DashboardTopProducts`, `DashboardRecentSales`, `DashboardOutletRanking`, `DashboardContribution`, `DashboardStaffOfDay`, `DashboardAttendance`, `DashboardCashPosition`, `DashboardInventoryAlerts`, `DashboardHoldsExpiring`, `DashboardExceptions`, `DashboardRiskSummary`, `DashboardOpsReadiness`, `DashboardAttention`, `DashboardOnboarding`, `DashboardQuickActions`, `DashboardWholesale`, `FieldSummaryCards` (wholesale field-sales rollup), `InsightCards` (AI-insights cards), `PlanUsageBanner`, `AIChatPanel` (the Claude AI insights chat), `BackupStatusCard`. `DashboardShared.jsx` is the shared helper module (`useCurrency` re-export, `DeltaArrow`, etc.) the rest of the folder imports from.

### `shopify/`
Shopify integration tab modules, rendered inside `ShopifyIntegrationRedesign.jsx` under a local `<ShopifyProvider>` (`ShopifyContext.jsx`). `useShopify()` exposes shared config/status/outlet/mapping-count state plus `apiFetch`, a thin `api.raw` wrapper (`(path, options) => api.raw(path, options)`) — callers check `res.ok` themselves rather than relying on `api.js`'s throw-on-error behavior, since this integration surfaces partial-success states (e.g. some product mappings succeeding, others not). Files: `ShopifyOverview`, `ShopifySettings` (config form), `ShopifyMappings` (product/location/customer mapping tables), `ShopifyImport`, `ShopifyReconciliation`, `ShopifyEvents` (webhook event log).

### `storefront/`
Public embedded shop at `/store/:tenantSlug` — unauthenticated, raw `fetch()` against `${API_BASE}/api/storefront/*` (never `api.js`). `StorefrontLayout.jsx` is the parent: fetches store config + categories on mount, owns a `StorefrontContext` (`useStorefront()`) exposing cart state, and renders the header/nav/`<Outlet>`. Cart state comes from `useStorefrontCart.js`, a token-based anonymous cart persisted in `localStorage` (this is also the landing side of the customer-portal "reorder" handoff — the cart page reads an `?adopt=` cart-token query param on mount). Other files: `StorefrontHome`, `StorefrontProducts`, `StorefrontProductDetail`, `StorefrontCart`, `StorefrontCheckout`, `StorefrontOrderStatus`.

### `marketing/`
Public marketing site pages, lazy-imported from `routes/publicRoutes.jsx`: `HomePage.jsx` (the `/` landing page, imported there as `MarketingHome` — there is no top-level `LandingPage.jsx` file, despite that name appearing in older docs/comments), `IndustryPage.jsx` (`/industries/:slug`), `IndustriesIndexPage.jsx` (`/industries`), `PricingPage.jsx` (`/pricing`), `WhySanoPosPage.jsx` (`/why-sanopos`), `Seo.jsx` (shared meta-tag helper), `components.jsx` (shared marketing UI building blocks), and a `content/` data directory.

### `public/`
Other unauthenticated, no-shell public pages reached via QR code/direct link rather than the marketing site: `PublicBookingPage.jsx`, `PublicRoomBookingPage.jsx`, `ReservationBookingPage.jsx`, `PublicRestaurantMenuPage.jsx`, `RestaurantPayPage.jsx`, `PublicInquiryPage.jsx`, `FormFillPublic.jsx`, `MemberCheckinKiosk.jsx`, `Terms.jsx`, `Privacy.jsx`. No `api.js`, no auth headers, raw `fetch()` throughout, self-contained styling.

---

## Top-level pages worth knowing

| File | Notes |
|------|-------|
| `LoginPage.jsx` | Standalone tenant login (multi-tenant mode) |
| `SignupPage.jsx` | Public self-service signup, gated by `SELF_SERVICE_SIGNUP=1` on the backend |
| `ResetPassword.jsx`, `VerifyEmail.jsx` | Public auth flows |
| `ReceiptPublicPage.jsx` | Public shareable receipt (`/receipt/:invoiceNumber`), no auth |
| `GiftCardBalancePage.jsx` | Public gift-card balance lookup (`/gift-card/:code`), no auth |
| `ContextSelect.jsx` | Post-login outlet/context picker; also the landing page for the impersonation flow (`?impersonate_token=...`) |
| `CustomerDisplayPage.jsx` | Second, unattended screen paired with the POS — no auth, no login, just local state/websocket sync |
| `AccessDenied.jsx`, `PlaceholderPage.jsx` | Error/stub pages — `PlaceholderPage` is rendered directly (no lazy import) by a handful of stubbed nav routes |
| `SetupWizard.jsx` | Single-tenant first-run setup wizard, imported eagerly (not lazy) |
| `Reports.jsx` | **Not legacy** — the active reports orchestrator, delegates tab rendering to `pages/reports/` |
| `Accounting.jsx`, `Attendance.jsx`, `Approvals.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx`, `InvoiceView.jsx` | Legacy page components, imported by their `*Redesign.jsx` wrapper in `redesign/` — don't edit unless the task specifically targets the wrapped legacy component |

The remaining bulk of top-level files (`AppointmentsRoute`, `RentalsRoute`, `RoomManagementRoute`, `TreatmentPlansRoute`, `ServiceTicketsRoute`, `ProjectsRoute`, `ContractsRoute`, `SubscriptionsRoute`, `CommissionPlansRoute`, `ManufacturerPartnersRoute`, and most other domain `*Route.jsx` files) are all thin pass-throughs per the convention above — when in doubt, open the matching `redesign/*Redesign.jsx` file instead of the route file.

---

## Conventions

- Never edit a `*Route.jsx` file except `POSRoute.jsx`/`ReportsRoute.jsx` — put logic in the matching `redesign/*Redesign.jsx`.
- `redesign/` is the primary codebase for tenant UI — when fixing a page, go there first.
- Admin pages use `adminFetch`; portal pages use `portalApi`; public pages (`public/`, `marketing/`, `storefront/`) use raw `fetch()`. Never replace any of these with `api.js`.
- Feature flag / currency / timestamp / CSV-export / Tailwind conventions are frontend-wide — see `frontend/src/CLAUDE.md` and `redesign/CLAUDE.md`, not repeated per-subdirectory.
